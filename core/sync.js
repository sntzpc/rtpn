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

// =====================
// Log Kegagalan Sinkron
// Struktur item: { local_id, ts, error, attempts, snapshot }
// =====================
export const SyncFailures = {
  async all(){ return IStore.getArr(Keys.SYNC_FAILURES); },

  // catat / perbarui kegagalan untuk sebuah local_id
  async record(rec, errorMsg){
    const list = await SyncFailures.all();
    const id = String(rec?.local_id ?? '');
    const idx = list.findIndex(x => String(x.local_id) === id);
    const now = new Date().toISOString();
    const snapshot = {
      tanggal:    rec?.tanggal || '',
      divisi_id:  rec?.divisi_id || '',
      blok_id:    rec?.blok_id || '',
      nik_mandor: rec?.nik_mandor || '',
      jjg:        rec?.jjg ?? '',
      hk:         rec?.hk ?? '',
      tonase_ton: rec?.tonase_ton ?? '',
    };
    if (idx >= 0){
      list[idx] = {
        ...list[idx],
        ts: now,
        error: String(errorMsg || 'Gagal'),
        attempts: (Number(list[idx].attempts) || 0) + 1,
        snapshot,
      };
    }else{
      list.push({ local_id: id, ts: now, error: String(errorMsg || 'Gagal'), attempts: 1, snapshot });
    }
    await IStore.setArr(Keys.SYNC_FAILURES, list);
  },

  // hapus catatan kegagalan (mis. setelah berhasil sinkron ulang)
  async clearOne(local_id){
    const list = await SyncFailures.all();
    const next = list.filter(x => String(x.local_id) !== String(local_id));
    await IStore.setArr(Keys.SYNC_FAILURES, next);
  },

  async clearMany(localIds){
    const set = new Set((localIds || []).map(String));
    const list = await SyncFailures.all();
    const next = list.filter(x => !set.has(String(x.local_id)));
    await IStore.setArr(Keys.SYNC_FAILURES, next);
  },

  async clearAll(){ await IStore.setArr(Keys.SYNC_FAILURES, []); },

  async count(){ return (await SyncFailures.all()).length; },
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

  const nik_auth = localStorage.getItem(Keys.NIK) || '';
  const token    = localStorage.getItem(Keys.TOKEN) || '';
  const res = await API.syncBulk({ records: all, nik_auth, token });
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
