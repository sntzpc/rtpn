// =====================
// File: core/storage.js
// Session kecil: localStorage
// Data besar: IndexedDB via IStore
// =====================
import { IStore } from './idb.js';

// Namespaced localStorage helpers (session kecil)
const NS = 'pp2:'; // pusingan panen v2

export const Keys = {
  // === Session ===
  ROLE : NS+'session.role',
  NIK  : NS+'session.nik',
  NAME : NS+'session.name',
  TOKEN: NS+'session.token',

  // Scope organisasi
  USER_KEBUN : NS+'session.kebun',
  USER_ESTATE: NS+'session.estate',
  USER_DIVISI: NS+'session.divisi', // JSON array of strings (besar → idb)

  // === Master (besar → idb)
  MASTER_COMPANY: NS+'master.company',
  MASTER_ESTATE : NS+'master.estate',
  MASTER_DIVISI : NS+'master.divisi',
  MASTER_KADVEL : NS+'master.kadvel',
  MASTER_BLOK   : NS+'master.blok',
  MASTER_MANDOR : NS+'master.mandor',
  MASTER_ASISTEN: NS+'master.asisten',
  MASTER_LIBUR  : NS+'master.libur',

  // === Input & Sinkron (besar → idb)
  INPUT_RECORDS: NS+'input.records',
  SYNC_QUEUE   : NS+'sync.queue',
  SYNC_FAILURES: NS+'sync.failures', // log kegagalan sinkron (besar → idb)
  PARAF_LOG    : NS+'report.paraf',

  // UI kecil
  THEME: 'pp2:ui.theme',
};

// localStorage (session kecil saja)
// localStorage (session kecil saja)
export const LStore = {
  get(key){ return localStorage.getItem(key); },
  set(key, val){ localStorage.setItem(key, val); },
  del(key){ localStorage.removeItem(key); },

  // ✅ kompatibilitas: banyak file memakai getArr/setArr
  getArr(key){
    try{
      const raw = localStorage.getItem(key);
      const v = JSON.parse(raw || '[]');
      return Array.isArray(v) ? v : [];
    }catch(_){ return []; }
  },
  setArr(key, arr){
    try{ localStorage.setItem(key, JSON.stringify(Array.isArray(arr) ? arr : [])); }
    catch(_){}
  },

  // ✅ opsional: bila ada yang pakai object
  getObj(key){
    try{
      const raw = localStorage.getItem(key);
      const v = JSON.parse(raw || '{}');
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }catch(_){ return {}; }
  },
  setObj(key, obj){
    try{ localStorage.setItem(key, JSON.stringify(obj && typeof obj === 'object' ? obj : {})); }
    catch(_){}
  },
};
// Re-export idb store
export { IStore };

// =====================
// Migrasi data besar dari localStorage → IndexedDB (sekali jalan)
// =====================
async function migrateKeyToIDB(key, kind){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return;
    let val = null;
    if (kind === 'arr') val = JSON.parse(raw || '[]');
    else if (kind === 'obj') val = JSON.parse(raw || '{}');
    else val = raw;

    await IStore.set(key, val);
    localStorage.removeItem(key); // ✅ kosongkan localStorage
  }catch(e){
    console.warn('[storage] migrate failed', key, e);
  }
}

(function boot(){
  // daftar data besar yg dulu disimpan localStorage
const BIG_ARR_KEYS = [
  Keys.MASTER_COMPANY, Keys.MASTER_ESTATE, Keys.MASTER_DIVISI, Keys.MASTER_KADVEL,
  Keys.MASTER_BLOK, Keys.MASTER_MANDOR, Keys.MASTER_ASISTEN, Keys.MASTER_LIBUR,
  Keys.INPUT_RECORDS, Keys.SYNC_QUEUE, Keys.SYNC_FAILURES, Keys.PARAF_LOG,

  // ❌ Keys.USER_DIVISI JANGAN dimigrasikan ke IDB
  // Karena core/api.js membaca USER_DIVISI dari localStorage (sync)
];

  // jalankan migrasi async tanpa blok UI
  (async ()=>{
    for (const k of BIG_ARR_KEYS){
      await migrateKeyToIDB(k, 'arr');
    }
  })();
})();
