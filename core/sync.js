import { Keys, LStore} from './storage.js';
import { hash} from './utils.js';


export function serverKeyOf(rec) {
    // Kunci server: mandor + tanggal + blok
    return hash(`${rec.nik_mandor}|${rec.tanggal}|${rec.blok_id}`);
}


export const SyncState = { queue() { return LStore.getArr(Keys.SYNC_QUEUE); },
    setQueue(arr) { LStore.setArr(Keys.SYNC_QUEUE, arr);},
    enqueue(local_id) {const q = new Set(SyncState.queue()); q.add(local_id); SyncState.setQueue([...q]);},
    dequeue(local_id) {const q = SyncState.queue().filter(id => id !== local_id); SyncState.setQueue(q); }
};


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