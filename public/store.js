/* ===========================================================================
   Segundo's Rhythm — storage layer

   There is nothing to configure. The app talks to /api/log on its own site,
   which keeps the shared log in Netlify's storage. Every device that opens
   the address sees the same data.

   ---------------------------------------------------------------------------
   THE RACE THIS CODE EXISTS TO PREVENT

   The app polls for other people's changes. A poll that LEFT the server
   before you tapped will COME BACK after you tapped, carrying a view of the
   world without your tap in it. Apply that blindly and:

     - a pee you just logged vanishes from the screen, and
     - an entry you just deleted comes back from the dead.

   Worse, once a deleted entry is back in local state, the next thing you log
   that day sends it to the server again as a live event — so the resurrection
   becomes permanent.

   The fix: local changes stay authoritative until the server has confirmed
   them. Every write is held in `pending` and re-applied on top of any
   snapshot that arrives, using the same merge the server performs. A pending
   write is only released once a snapshot arrives that is new enough to
   contain it (`rev` >= the revision the server assigned that write).
   =========================================================================== */
window.Store = (function(){
  "use strict";

  var API      = "/api/log";
  var OUTBOX   = "segundo-outbox";
  var online   = false;
  var lastSync = null;
  var lastRev  = -1;              // newest revision applied; older ones are stale
  var listeners = [];
  var chain    = Promise.resolve();
  var timer    = null;

  /* date -> { upserts, removed, rev }
     `upserts` is only what this device changed — never the whole day, so a
     stale local copy can never re-add something another phone deleted.
     rev is null while the write is in flight or waiting in the outbox, and
     becomes the server's revision number once the write has been accepted. */
  var pending  = new Map();

  function emit(payload){ listeners.forEach(function(fn){ try{ fn(payload); }catch(e){} }); }
  function queue(fn){ chain = chain.then(fn, fn); return chain; }

  /* Identical to the merge in netlify/functions/log.mjs — union by id, then
     subtract the ids this change deleted. */
  function mergeDay(existing, incoming, removed){
    var gone = {};
    if(Array.isArray(removed)) removed.forEach(function(id){ gone[id] = 1; });
    else if(removed) gone = removed;
    var byId = {};
    (existing||[]).forEach(function(e){ if(e && e.id) byId[e.id] = e; });
    (incoming||[]).forEach(function(e){ if(e && e.id) byId[e.id] = e; });
    return Object.keys(byId).map(function(k){ return byId[k]; })
      .filter(function(e){ return !gone[e.id]; })
      .sort(function(a,b){ return (a.at||0) - (b.at||0); });
  }

  /* Fold one change into another, so a day's worth of unsent edits collapses
     into a single correct delta. Order matters: the newer change wins.
       - anything the new change deletes drops out of the older upserts
       - anything the new change (re)adds stops being a tombstone */
  function compose(prev, next){
    var goneNow = {}; (next.removed||[]).forEach(function(id){ goneNow[id] = 1; });
    var liveNow = {}; (next.upserts||[]).forEach(function(e){ liveNow[e.id] = 1; });
    var upserts = mergeDay(
      (prev.upserts||[]).filter(function(e){ return !goneNow[e.id]; }),
      next.upserts || [], {});
    var removed = (prev.removed||[]).filter(function(id){ return !liveNow[id]; })
      .concat(next.removed || []);
    removed = removed.filter(function(id, i, a){ return a.indexOf(id) === i; });
    return { upserts:upserts, removed:removed };
  }

  /* ---- the outbox: writes that could not reach the server ---- */
  function outbox(){
    try{ return JSON.parse(localStorage.getItem(OUTBOX) || "[]"); }catch(e){ return []; }
  }
  function setOutbox(list){
    try{ localStorage.setItem(OUTBOX, JSON.stringify(list)); }catch(e){}
  }
  /* Several taps can pile up with no signal. Each one is only a delta now, so
     they have to be FOLDED together — keeping just the newest would throw the
     earlier ones away. */
  function park(day){
    var list = outbox();
    var i = -1;
    for(var k=0;k<list.length;k++) if(list[k].date === day.date){ i = k; break; }
    if(i < 0){ list.push({ date:day.date, upserts:day.upserts, removed:day.removed }); }
    else {
      var folded = compose(list[i], day);
      list[i] = { date:day.date, upserts:folded.upserts, removed:folded.removed };
    }
    setOutbox(list);
  }
  function restorePending(){
    // Anything left in the outbox from a previous visit is still unconfirmed.
    outbox().forEach(function(d){
      pending.set(d.date, { upserts:d.upserts || [], removed:d.removed || [], rev:null });
    });
  }

  function post(body){
    return fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){
      if(!r.ok) return r.json().catch(function(){ return {}; })
        .then(function(j){ throw new Error(j.error || ("Server said " + r.status)); });
      return r.json();
    });
  }

  /* Turn a server snapshot into the view the app should show: the server's
     data, with every unconfirmed local change laid back on top. */
  function apply(res){
    online = true;
    lastSync = Date.now();

    var rev = typeof res.rev === "number" ? res.rev : 0;
    if(rev < lastRev) return res;          // an out-of-order reply; ignore it
    lastRev = rev;

    var map = new Map();
    (res.days || []).forEach(function(d){
      map.set(d.date, { date:d.date, events: Array.isArray(d.events) ? d.events : [] });
    });

    pending.forEach(function(p, date){
      if(p.rev !== null && rev >= p.rev){ pending.delete(date); return; }  // confirmed
      var base = map.get(date);
      var merged = mergeDay(base ? base.events : [], p.upserts, p.removed);
      if(merged.length) map.set(date, { date:date, events:merged });
      else map.delete(date);
    });

    emit({ days:map, config:res.config || null });
    return res;
  }

  function flush(){
    var list = outbox();
    if(!list.length) return Promise.resolve(null);
    var next = list[0];
    return post({ day: next }).then(function(res){
      setOutbox(outbox().filter(function(d){ return d.date !== next.date; }));
      var p = pending.get(next.date);
      if(p) p.rev = res.rev;
      apply(res);
      return flush();
    });
  }

  function refresh(){
    return fetch(API, { headers:{ "accept":"application/json" }, cache:"no-store" })
      .then(function(r){ if(!r.ok) throw new Error("Server said " + r.status); return r.json(); })
      .then(function(res){
        if(outbox().length) return flush();
        return apply(res);
      })
      .catch(function(err){ online = false; throw err; });
  }

  function startPolling(){
    if(timer) return;
    var every = window.__SEGUNDO_POLL_MS || 20000;   // shortened by the test harness
    timer = setInterval(function(){
      if(document.visibilityState === "visible") Store.sync().catch(function(){});
    }, every);
    document.addEventListener("visibilitychange", function(){
      if(document.visibilityState === "visible") Store.sync().catch(function(){});
    });
    window.addEventListener("online", function(){ Store.sync().catch(function(){}); });
  }

  var Store = {
    isCloud:  function(){ return online; },
    pending:  function(){ return outbox().length; },
    lastSync: function(){ return lastSync; },
    onChange: function(fn){ listeners.push(fn); },

    init: function(){
      restorePending();
      return Store.sync()
        .then(function(){ startPolling(); return "cloud"; })
        .catch(function(){ startPolling(); return "local"; });
    },

    /* Reads share the write queue. Without that, a poll can land in the gap
       between a local change and the request that saves it. */
    sync: function(){ return queue(function(){ return refresh(); }); },

    /* `upserts` is only what this change added or altered; `removed` the ids
       it deleted. Sending the whole day instead would let a stale device
       resurrect another device's deletion. The pending entry is registered
       BEFORE the request goes out, so a snapshot arriving mid-flight cannot
       undo it. */
    saveDay: function(date, upserts, removed){
      var day = { date:date, upserts:upserts || [], removed:removed || [] };
      var prev = pending.get(date) || { upserts:[], removed:[] };
      var folded = compose(prev, day);
      pending.set(date, { upserts:folded.upserts, removed:folded.removed, rev:null });
      return queue(function(){
        return post({ day: day }).then(function(res){
          var p = pending.get(date);
          if(p) p.rev = res.rev;
          apply(res);
        }).catch(function(err){
          online = false;
          park(day);                       // pending entry stays, so it survives polls
          console.warn("Saved on this device, will sync later:", err.message);
        });
      });
    },

    saveConfig: function(config){
      return queue(function(){
        return post({ config: config }).then(apply).catch(function(err){
          console.warn("Settings not synced yet:", err.message);
        });
      });
    },

    importAll: function(dayList, config){
      var payload = { days: dayList.filter(function(d){
        return d && d.date && (d.events||[]).length;
      }), config: config || null };
      return queue(function(){ return post({ import: payload }).then(apply); });
    },

    /* Exposed for the stress test. */
    _pending: function(){ return pending; }
  };
  return Store;
})();
