import { Keys, LStore } from './storage.js';
import { hash } from './utils.js';
import { API } from './api.js';

// Kunci server: mandor + tanggal + blok
export function serverKeyOf(rec) {
  return hash(`${rec.nik_mandor}|${rec.tanggal}|${rec.blok_id}`);
}

// State antrean sinkron
export const SyncState = {
  queue() { return LStore.getArr(Keys.SYNC_QUEUE); },
  setQueue(arr) { LStore.setArr(Keys.SYNC_QUEUE, arr);},
  enqueue(local_id) {
    const q = new Set(SyncState.queue()); q.add(local_id);
    SyncState.setQueue([...q]);
  },
  dequeue(local_id) {
    const q = SyncState.queue().filter(id => id !== local_id);
    SyncState.setQueue(q);
  }
};

// CRUD record lokal (offline)
export function upsertRecord(rec) {
  const list = LStore.getArr(Keys.INPUT_RECORDS);
  const idx = list.findIndex(r => r.local_id === rec.local_id);
  if (idx >= 0) list[idx] = rec;
  else list.push(rec);
  LStore.setArr(Keys.INPUT_RECORDS, list);
}

export function getRecord(local_id) {
  const list = LStore.getArr(Keys.INPUT_RECORDS);
  return list.find(r => r.local_id === local_id) || null;
}

export function listRecords(filterFn = null) {
  const list = LStore.getArr(Keys.INPUT_RECORDS);
  return filterFn ? list.filter(filterFn) : list;
}

// Helper nyaman: simpan offline + masuk antrean
export function saveOffline(rec){
  if (!rec.local_id){
    rec.local_id = `loc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  }
  upsertRecord(rec);
  SyncState.enqueue(rec.local_id);
  return rec.local_id;
}

// Kirim antrean pending ke server (bulk)
export async function bulkSyncByQueue(){
  const ids = SyncState.queue();
  if (!ids.length) return { ok:true, synced:0 };

  // Ambil record utuh
  const all = ids.map(getRecord).filter(Boolean);
  if (!all.length){
    SyncState.setQueue([]);
    return { ok:true, synced:0 };
  }

  // Kirim ke backend (server wajib guard role+divisi)
  const res = await API.syncBulk({ records: all });
  if (res && res.ok){
    SyncState.setQueue([]); // clear queue jika sukses
    return { ok:true, synced: all.length };
  }
  return { ok:false, error: res?.error || 'Sync failed' };
}

// Opsional: auto-sync saat online kembali
if (typeof window !== 'undefined'){
  window.addEventListener('online', ()=> {
    bulkSyncByQueue().catch(console.error);
  });
}
