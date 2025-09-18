// =====================
// File: features/offline-prep.js
// =====================
import { Keys, LStore } from '../core/storage.js';
import { Progress } from '../core/progress.js';
import { API } from '../core/api.js';

// Flag “sudah siap offline” (first successful warmup)
const OFFLINE_READY_FLAG = 'offline.ready.v1';

// Util kecil buat efek progres terasa (tanpa blok UI lama)
const _sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

// Cek array kosong/null/invalid
function _isEmptyArr(a){ return !Array.isArray(a) || a.length===0; }

async function _tryFetchAndCache({ label, key, fetcher }){
  Progress.update(label);
  // Kalau sudah ada di cache, skip cepat (tetap beri sedikit delay biar progres enak dilihat)
  let current = LStore.getArr(key);
  if (!_isEmptyArr(current)){
    await _sleep(150);
    return;
  }

  // Coba fetch via API bila tersedia, kalau tidak ada method-nya → graceful skip
  try{
    let data = null;

    if (typeof fetcher === 'function'){
      data = await fetcher();
    } else if (API && typeof API.getMaster === 'function'){
      // fallback generik: API.getMaster({name})
      data = await API.getMaster({ name: key });
      data = data?.data || data; // normalisasi
    }

    if (Array.isArray(data) && data.length){
      LStore.setArr(key, data);
    }
  }catch(e){
    // Tidak fatal: warmup lanjut ke task berikutnya
    console.warn('[offline-prep] Gagal fetch', label, e);
  }finally{
    await _sleep(150);
  }
}

/**
 * Jalankan sekali (idempotent). Aman dipanggil dari banyak tempat:
 * - Saat app pertama kali render halaman
 * - Saat kembali online
 */
export async function runOfflineWarmupOnce(){
  try{
    if (localStorage.getItem(OFFLINE_READY_FLAG)) return;     // sudah siap
    if (!navigator.onLine) return;                             // butuh online pertama kali

    const TASKS = [
      // Master data (silakan tambah/kurangi sesuai app)
      { label:'Mengunduh master: Estate', key: Keys.MASTER_ESTATE, fetcher: API?.fetchEstate },
      { label:'Mengunduh master: Divisi', key: Keys.MASTER_DIVISI, fetcher: API?.fetchDivisi },
      { label:'Mengunduh master: Kadvel', key: Keys.MASTER_KADVEL, fetcher: API?.fetchKadvel },
      { label:'Mengunduh master: Mandor', key: Keys.MASTER_MANDOR, fetcher: API?.fetchMandor },
      { label:'Mengunduh master: Blok',   key: Keys.MASTER_BLOK,   fetcher: API?.fetchBlok },
      { label:'Mengunduh master: Hari Libur', key: Keys.MASTER_LIBUR, fetcher: API?.fetchLibur },

      // Data operasional minimal agar report/statistik bisa jalan offline
      // (biarkan kosong bila memang hanya dari input lokal)
      // { label:'Sinkron awal input (opsional)', key: Keys.INPUT_RECORDS, fetcher: API?.fetchRecords },
    ];

    // Buka modal (indeterminate dulu, lalu switch ke determinate)
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

    // (Opsional) indeks ringan untuk report agar responsif offline
    Progress.update('Mempersiapkan indeks ringkas…');
    await _sleep(200);

    // Tandai siap offline
    localStorage.setItem(OFFLINE_READY_FLAG, '1');
  }catch(e){
    console.warn('[offline-prep] Warmup error:', e);
  }finally{
    Progress.update('Selesai');
    Progress.close();
  }
}

/** Reset flag (debug/opsional) */
export function resetOfflineWarmupFlag(){
  localStorage.removeItem(OFFLINE_READY_FLAG);
}
