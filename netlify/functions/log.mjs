/* ===========================================================================
   The shared log, stored in Netlify Blobs.

   This is the only server-side code in the app. It needs no keys and no
   configuration — when it runs on a deployed Netlify site, Blobs works out
   who it belongs to on its own.

   Everything lives in one JSON blob. A week of heavy logging is about 20 KB,
   so a year sits comfortably under a megabyte; the blob limit is 5 GB.

   Writes MERGE rather than replace, so two phones logging at the same moment
   cannot wipe each other's entry.

   Deletion needs more than a merge. A phone holding a stale copy of a day
   would re-send a deleted entry the next time anything on that day changed,
   and the union would quietly bring it back. So two things guard it: a client
   sends only the entries it actually CHANGED, never the whole day, and the
   server keeps a tombstone for every deleted id and filters it out of any
   incoming write. Tombstones are pruned after 45 days; ids are never reused,
   so nothing legitimate is ever blocked.
   =========================================================================== */
import { getStore } from "@netlify/blobs";

const STORE = "segundo";
const KEY   = "log";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });

async function read(store){
  try{
    const data = await store.get(KEY, { type: "json" });
    if(data && typeof data === "object" && data.days) return data;
  }catch(e){
    // A missing blob is the normal first-run case, not an error.
  }
  return { days:{}, config:null, rev:0 };
}

/* Union by event id, newest wins on a clash, then drop anything tombstoned.
   Sorted by time so the client never has to. */
function mergeDay(existing = [], incoming = [], gone = new Set()){
  const byId = new Map();
  for(const e of existing) if(e && e.id) byId.set(e.id, e);
  for(const e of incoming) if(e && e.id) byId.set(e.id, e);
  return [...byId.values()]
    .filter(e => !gone.has(e.id))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

const TOMB_TTL = 45 * 24 * 60 * 60 * 1000;
function tombsFor(log, date, addIds = []){
  log.tombstones = log.tombstones || {};
  const now = Date.now();
  const t = log.tombstones[date] = log.tombstones[date] || {};
  for(const id of addIds) t[id] = now;
  for(const id of Object.keys(t)) if(now - t[id] > TOMB_TTL) delete t[id];
  if(!Object.keys(t).length) delete log.tombstones[date];
  return new Set(Object.keys(t));
}

function shape(log){
  return {
    days: Object.keys(log.days || {}).sort().map(date => ({
      date, events: log.days[date] || []
    })),
    config: log.config || null,
    rev: log.rev || 0,
    updatedAt: log.updatedAt || null
  };
}

export default async (req) => {
  const store = getStore(STORE);

  if(req.method === "GET"){
    return json(shape(await read(store)));
  }

  if(req.method !== "POST"){
    return json({ error: "Use GET to read or POST to write." }, 405);
  }

  let body;
  try{ body = await req.json(); }
  catch{ return json({ error: "Body was not valid JSON." }, 400); }

  const log = await read(store);
  log.days = log.days || {};

  // One day changed — the ordinary case, a tap on somebody's phone.
  // `upserts` is only what that phone changed; older clients send `events`.
  if(body.day && body.day.date){
    const { date, upserts, events = [], removed = [] } = body.day;
    const incoming = Array.isArray(upserts) ? upserts : events;
    const gone = tombsFor(log, date, removed);
    const merged = mergeDay(log.days[date], incoming, gone);
    if(merged.length) log.days[date] = merged;
    else delete log.days[date];
  }

  // A whole backup arriving at once. This is an explicit restore, so it
  // deliberately clears tombstones for anything it brings back.
  if(body.import && Array.isArray(body.import.days)){
    for(const d of body.import.days){
      if(!d || !d.date || !Array.isArray(d.events)) continue;
      if(log.tombstones && log.tombstones[d.date]){
        for(const e of d.events) delete log.tombstones[d.date][e.id];
        if(!Object.keys(log.tombstones[d.date]).length) delete log.tombstones[d.date];
      }
      const merged = mergeDay(log.days[d.date], d.events, tombsFor(log, d.date));
      if(merged.length) log.days[d.date] = merged;
    }
    if(body.import.config) log.config = body.import.config;
  }

  if(body.config) log.config = body.config;

  log.rev = (log.rev || 0) + 1;
  log.updatedAt = new Date().toISOString();

  try{
    await store.setJSON(KEY, log);
  }catch(err){
    return json({ error: "Could not save: " + (err?.message || "unknown") }, 500);
  }

  return json(shape(log));
};

export const config = { path: "/api/log" };
