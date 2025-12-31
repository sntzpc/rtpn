// =====================
// File: core/idb.js
// IndexedDB KV store untuk data besar (master + records + queue)
// =====================

const DB_NAME  = 'pp2-db';
const DB_VER   = 1;
const STORE_KV = 'kv';

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)){
        db.createObjectStore(STORE_KV);
      }
    };

    req.onsuccess = ()=> resolve(req.result);
    req.onerror   = ()=> reject(req.error);
  });
}

async function withStore(mode, fn){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_KV, mode);
    const st = tx.objectStore(STORE_KV);

    let out;
    try{
      out = fn(st);
    }catch(e){
      try{ tx.abort(); }catch(_){}
      reject(e);
      return;
    }

    tx.oncomplete = async ()=> {
      try{
        // jika fn mengembalikan Promise, tunggu selesai
        resolve(await out);
      }catch(e){
        reject(e);
      }
    };
    tx.onerror = ()=> reject(tx.error || new Error('IDB_TX_ERROR'));
    tx.onabort = ()=> reject(tx.error || new Error('IDB_TX_ABORT'));
  });
}

export const IStore = {
  async get(key){
    return withStore('readonly', (st)=> new Promise((resolve, reject)=>{
      const r = st.get(key);
      r.onsuccess = ()=> resolve(r.result);
      r.onerror   = ()=> reject(r.error);
    }));
  },

  async set(key, val){
    return withStore('readwrite', (st)=> new Promise((resolve, reject)=>{
      const r = st.put(val, key);
      r.onsuccess = ()=> resolve(true);
      r.onerror   = ()=> reject(r.error);
    }));
  },

  async del(key){
    return withStore('readwrite', (st)=> new Promise((resolve, reject)=>{
      const r = st.delete(key);
      r.onsuccess = ()=> resolve(true);
      r.onerror   = ()=> reject(r.error);
    }));
  },

  async getArr(key){
    const v = await this.get(key);
    return Array.isArray(v) ? v : [];
  },

  async setArr(key, arr){
    return this.set(key, Array.isArray(arr) ? arr : []);
  },

  // ============================================================
  // RESET / CLEAR
  // ============================================================

  // ✅ Method "utama" untuk reset: hapus DB aplikasi ini saja
  async clearDatabase(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = ()=> resolve(true);
      req.onerror   = ()=> reject(req.error);
      // jika ada tab lain masih pegang DB, kita anggap OK agar UI tidak stuck
      req.onblocked = ()=> resolve(true);
    });
  },

  // ✅ Alias untuk kompatibilitas (mengatasi error "clearAll is not a function")
  async clearAll(){
    // beberapa file lama memanggil clearAll()
    return this.clearDatabase();
  },

  // (Opsional) alias lain kalau ada kode lama memanggil clear()
  async clear(){
    return this.clearDatabase();
  },
};
