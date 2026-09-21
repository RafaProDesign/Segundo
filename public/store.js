/* ===========================================================================
   Segundo's Rhythm — storage layer

   There is nothing to configure. The app talks to /api/log on its own site,
   which keeps the shared log in Netlify's storage. Every device that opens
   the address sees the same data.

   Two things this has to survive:

     no signal   A tap on a walk must not be lost. Failed writes go to an
                 outbox in this browser and are replayed the moment the
                 server is reachable again.

     two phones  You and your partner logging at the same moment must not
                 overwrite each other. The server merges by event id, and
                 deletions travel as an explicit list so a merge cannot
                 resurrect something you removed.
   =========================================================================== */
window.Store = (function(){
  "use strict";

  var API      = "/api/log";
  var OUTBOX   = "segundo-outbox";
  var online   = false;
  var lastSync = null;
  var listeners = [];
  var chain    = Promise.resolve();
  var timer    = null;

  function emit(payload){ listeners.forEach(function(fn){ try{ fn(payload); }catch(e){} }); }
  function queue(fn){ chain = chain.then(fn, fn); return chain; }

  /* ---- the outbox ---- */
  function outbox(){
    try{ return JSON.parse(localStorage.getItem(OUTBOX) || "[]"); }catch(e){ return []; }
  }
  function setOutbox(list){
    try{ localStorage.setItem(OUTBOX, JSON.stringify(list)); }catch(e){}
  }
  function park(day){
    // Each entry carries a whole day, so only the newest per date matters.
    var list = outbox().filter(function(d){ return d.date !== day.date; });
    list.push(day);
    setOutbox(list);
  }
  function pending(){ return outbox().length; }

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

  function apply(res){
    online = true;
    lastSync = Date.now();
    var map = new Map();
    (res.days || []).forEach(function(d){
      map.set(d.date, { date:d.date, events: Array.isArray(d.events) ? d.events : [] });
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
      apply(res);
      return flush();          // keep going until the outbox is empty
    });
  }

  function refresh(){
    return fetch(API, { headers: { "accept":"application/json" }, cache: "no-store" })
      .then(function(r){ if(!r.ok) throw new Error("Server said " + r.status); return r.json(); })
      .then(function(res){
        // Anything waiting takes priority, otherwise we would paint over it.
        if(pending()) return flush();
        return apply(res);
      })
      .catch(function(err){
        online = false;
        throw err;
      });
  }

  function startPolling(){
    if(timer) return;
    // Phone-first: check on a gentle timer, and immediately whenever the app
    // comes back to the foreground, which is when it actually matters.
    timer = setInterval(function(){
      if(document.visibilityState === "visible") refresh().catch(function(){});
    }, 20000);
    document.addEventListener("visibilitychange", function(){
      if(document.visibilityState === "visible") refresh().catch(function(){});
    });
    window.addEventListener("online", function(){ refresh().catch(function(){}); });
  }

  return {
    isCloud:  function(){ return online; },
    pending:  pending,
    lastSync: function(){ return lastSync; },
    onChange: function(fn){ listeners.push(fn); },

    init: function(){
      return refresh()
        .then(function(){ startPolling(); return "cloud"; })
        .catch(function(){ startPolling(); return "local"; });
    },

    sync: function(){ return refresh(); },

    /* `events` is the day's full list after the change; `removed` the ids
       this change deleted. Both are needed for a safe merge. */
    saveDay: function(date, events, removed){
      var day = { date:date, events:events, removed:removed || [] };
      return queue(function(){
        return post({ day: day }).then(apply).catch(function(err){
          online = false;
          park(day);
          console.warn("Saved locally, will sync later:", err.message);
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

    /* A whole backup at once. */
    importAll: function(dayList, config){
      var payload = { days: dayList.filter(function(d){
        return d && d.date && (d.events||[]).length;
      }), config: config || null };
      return queue(function(){ return post({ import: payload }).then(apply); });
    }
  };
})();
