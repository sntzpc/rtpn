// Namespaced localStorage helpers
const NS = 'pp2:'; // pusingan panen v2

export const Keys = {
  // === Session ===
  ROLE : NS+'session.role',
  NIK  : NS+'session.nik',
  NAME : NS+'session.name',
  TOKEN: NS+'session.token',

  // Scope organisasi (BARU)
  USER_KEBUN : NS+'session.kebun',
  USER_ESTATE: NS+'session.estate',
  USER_DIVISI: NS+'session.divisi', // JSON array of strings

  // === Master (cache) ===
  MASTER_COMPANY: NS+'master.company',
  MASTER_ESTATE : NS+'master.estate',
  MASTER_DIVISI : NS+'master.divisi',
  MASTER_KADVEL : NS+'master.kadvel',
  MASTER_BLOK   : NS+'master.blok',
  MASTER_MANDOR : NS+'master.mandor',
  MASTER_ASISTEN: NS+'master.asisten',
  MASTER_LIBUR : NS+'master.libur',

  // === Data aktual (cache; BARU) ===
  ACTUAL_CACHE: NS+'actual.cache', // JSON object/array sesuai kebutuhan UI

  // === Input & Sinkron ===
  INPUT_RECORDS: NS+'input.records', // array of records { local_id, ... }
  SYNC_QUEUE   : NS+'sync.queue',    // array of local_id pending sync
  PARAF_LOG    : NS+'report.paraf',  // array

  // === UI ===
  THEME: 'pp2:ui.theme'
};

// JSON helpers
function getArr(key){ try{ return JSON.parse(localStorage.getItem(key)||'[]'); }catch(_){ return []; } }
function setArr(key, arr){ localStorage.setItem(key, JSON.stringify(arr||[])); }
function getObj(key){ try{ return JSON.parse(localStorage.getItem(key)||'{}'); }catch(_){ return {}; } }
function setObj(key, obj){ localStorage.setItem(key, JSON.stringify(obj||{})); }

export const LStore = {
  getArr, setArr, getObj, setObj,
  get(key){ return localStorage.getItem(key); },
  set(key, val){ localStorage.setItem(key, val); },
  del(key){ localStorage.removeItem(key); },
  clearAll(){
    Object.keys(localStorage)
      .filter(k => k.startsWith(NS))
      .forEach(k => localStorage.removeItem(k));
  }
};

// Seed minimal arrays if missing
(function init(){
  if (!localStorage.getItem(Keys.INPUT_RECORDS)) setArr(Keys.INPUT_RECORDS, []);
  if (!localStorage.getItem(Keys.SYNC_QUEUE))    setArr(Keys.SYNC_QUEUE, []);
  if (!localStorage.getItem(Keys.PARAF_LOG))     setArr(Keys.PARAF_LOG, []);
  if (!localStorage.getItem(Keys.USER_DIVISI))   setArr(Keys.USER_DIVISI, []);
  if (!localStorage.getItem(Keys.ACTUAL_CACHE))  setObj(Keys.ACTUAL_CACHE, {});
})();
