/* ===========================================================================
   The shared log, stored in Netlify Blobs.

   This is the only server-side code in the app. It needs no keys and no
   configuration — when it runs on a deployed Netlify site, Blobs works out
   who it belongs to on its own.

   Everything lives in one JSON blob. A week of heavy logging is about 20 KB,
   so a year sits comfortably under a megabyte; the blob limit is 5 GB.

   Writes MERGE rather than replace, so two phones logging at the same moment
   cannot wipe each other's entry. Deletions are sent explicitly as a list of
   ids, which is the one thing a blind merge would otherwise undo.
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

/* Union by event id, newest wins on a clash, then drop anything the caller
   says was deleted. Sorted by time so the client never has to. */
function mergeDay(existing = [], incoming = [], removed = []){
  const gone = new Set(removed);
  const byId = new Map();
  for(const e of existing) if(e && e.id) byId.set(e.id, e);
  for(const e of incoming) if(e && e.id) byId.set(e.id, e);
  return [...byId.values()]
    .filter(e => !gone.has(e.id))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
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
  if(body.day && body.day.date){
    const { date, events = [], removed = [] } = body.day;
    const merged = mergeDay(log.days[date], events, removed);
    if(merged.length) log.days[date] = merged;
    else delete log.days[date];
  }

  // A whole backup arriving at once.
  if(body.import && Array.isArray(body.import.days)){
    for(const d of body.import.days){
      if(!d || !d.date || !Array.isArray(d.events)) continue;
      const merged = mergeDay(log.days[d.date], d.events, []);
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
