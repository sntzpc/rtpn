import { Keys, IStore } from './storage.js';
import { hash } from './utils.js';
import { API } from './api.js';

export function serverKeyOf(rec) {
  return hash(`${rec.nik_mandor}|${rec.tanggal}|${rec.blok_id}`);
}

// ✅ Queue di IndexedDB
export const SyncState = {
  async queue() { return IStore.getArr(Keys.SYNC_QUEUE); },
  async setQueue(arr) { return IStore.setArr(Keys.SYNC_QUEUE, arr); },

  async enqueue(local_id) {
    const q = new Set(await SyncState.queue()); q.add(local_id);
    await SyncState.setQueue([...q]);
  },

  async dequeue(local_id) {
    const q = new Set(await SyncState.queue()); q.delete(local_id);
    await SyncState.setQueue([...q]);
  }
};

export async function getRecord(local_id){
  const list = await IStore.getArr(Keys.INPUT_RECORDS);
  return list.find(r=>String(r.local_id)===String(local_id)) || null;
}

export async function upsertRecord(rec){
  const list = await IStore.getArr(Keys.INPUT_RECORDS);
  const idx = list.findIndex(r=>String(r.local_id)===String(rec.local_id));
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  await IStore.setArr(Keys.INPUT_RECORDS, list);
}

export async function bulkSyncByQueue(){
  const q = await SyncState.queue();
  if (!q.length) return { ok:true, synced:0 };

  const records = await IStore.getArr(Keys.INPUT_RECORDS);
  const map = new Map(records.map(r=>[String(r.local_id), r]));
  const all = q.map(id=> map.get(String(id))).filter(Boolean);

  if (!all.length){
    await SyncState.setQueue([]);
    return { ok:true, synced:0 };
  }

  const res = await API.syncBulk({ records: all });
  if (res && res.ok){
    await SyncState.setQueue([]);
    return { ok:true, synced: all.length };
  }
  return { ok:false, error: res?.error || 'Sync failed' };
}

if (typeof window !== 'undefined'){
  window.addEventListener('online', ()=> {
    bulkSyncByQueue().catch(console.error);
  });
}
