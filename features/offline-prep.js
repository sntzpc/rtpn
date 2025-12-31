// =====================
// File: features/offline-prep.js
// =====================
import { Keys, IStore } from '../core/storage.js';
import { Progress } from '../core/progress.js';
import { API } from '../core/api.js';

// Flag “sudah siap offline” (first successful warmup)
const OFFLINE_READY_FLAG = 'offline.ready.v1';

const _sleep = (ms)=> new Promise(r=> setTimeout(r, ms));
function _isEmptyArr(a){ return !Array.isArray(a) || a.length===0; }

async function _tryFetchAndCache({ label, key, fetcher }){
  Progress.update(label);

  // ✅ cek cache di IndexedDB
  let current = [];
  try { current = await IStore.getArr(key); } catch (_) { current = []; }
  if (!_isEmptyArr(current)){
    await _sleep(150);
    return;
  }

  try{
    let data = null;

    if (typeof fetcher === 'function'){
      data = await fetcher();
    } else if (API && typeof API.getMaster === 'function'){
      data = await API.getMaster({ name: key });
      data = data?.data || data;
    }

    if (Array.isArray(data) && data.length){
      // ✅ simpan ke IndexedDB
      await IStore.setArr(key, data);
    }
  }catch(e){
    console.warn('[offline-prep] Gagal fetch', label, e);
  }finally{
    await _sleep(150);
  }
}

export async function runOfflineWarmupOnce(){
  try{
    if (localStorage.getItem(OFFLINE_READY_FLAG)) return;
    if (!navigator.onLine) return;

    const TASKS = [
      { label:'Mengunduh master: Estate', key: Keys.MASTER_ESTATE, fetcher: API?.fetchEstate },
      { label:'Mengunduh master: Divisi', key: Keys.MASTER_DIVISI, fetcher: API?.fetchDivisi },
      { label:'Mengunduh master: Kadvel', key: Keys.MASTER_KADVEL, fetcher: API?.fetchKadvel },
      { label:'Mengunduh master: Mandor', key: Keys.MASTER_MANDOR, fetcher: API?.fetchMandor },
      { label:'Mengunduh master: Blok',   key: Keys.MASTER_BLOK,   fetcher: API?.fetchBlok },
      { label:'Mengunduh master: Hari Libur', key: Keys.MASTER_LIBUR, fetcher: API?.fetchLibur },
    ];

    Progress.open({
      title: 'Menyiapkan Mode Offline',
      subtitle: 'Mengunduh & menyimpan cache agar aplikasi bisa dipakai tanpa internet…'
    });
    Progress.switchToDeterminate(TASKS.length);

    let done = 0;
    for (const t of TASKS){
      await _tryFetchAndCache(t);
      done++;
      Progress.tick(done, TASKS.length);
    }

    Progress.update('Mempersiapkan indeks ringkas…');
    await _sleep(200);

    localStorage.setItem(OFFLINE_READY_FLAG, '1');
  }catch(e){
    console.warn('[offline-prep] Warmup error:', e);
  }finally{
    Progress.update('Selesai');
    Progress.close();
  }
}

export function resetOfflineWarmupFlag(){
  localStorage.removeItem(OFFLINE_READY_FLAG);
}
