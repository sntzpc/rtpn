// =====================
// api.js (fixed & hardened) + session attach + auth guard
// =====================
import { Keys /*, LStore*/ } from './storage.js';

function _auth(){
  return {
    nik_auth: localStorage.getItem(Keys.NIK)   || '',
    token:    localStorage.getItem(Keys.TOKEN) || '',
  };
}

const DEFAULT_EXEC =
  'https://script.google.com/macros/s/AKfycbzYHcrz_tfrsL3xhdn6VPIwbMQ7Q0BgUvR3WTjSsZemYItfljKWdnU6_sz4Jpn26Ebadg/exec';

// Urutan preferensi: window.GAS_BASE_URL → localStorage.API_BASE → DEFAULT_EXEC
const BASE_URL = (() => {
  const w = (typeof window !== 'undefined') ? window : {};
  const fromWin = w.GAS_BASE_URL || '';
  const fromLS  = (typeof localStorage !== 'undefined' && localStorage.getItem('API_BASE')) || '';
  return String(fromWin || fromLS || DEFAULT_EXEC).replace(/\/$/, '');
})();

// Sanity log (tidak memicu preflight)
if (BASE_URL.includes('/macros/echo')) {
  console.error('BASE_URL salah: gunakan URL Web App (/exec), bukan /macros/echo');
}
if (!BASE_URL.endsWith('/exec')) {
  console.warn('BASE_URL sebaiknya diakhiri dengan /exec (Web App).');
}

// Selalu tempelkan kredensial + sesi (role/nik/divisi)
function sessionAttach(params = {}){
  // role & nik: ambil dari session bila tidak diberikan
  const role = params.role != null ? params.role : (localStorage.getItem(Keys.ROLE) || '');
  const nik  = params.nik  != null ? params.nik  : (localStorage.getItem(Keys.NIK)  || '');

  // divisi (khusus asisten) → kirim CSV "SRIE1,SRIE2"
  let divisiCsv = params.divisi;
  if (divisiCsv == null){
    try{
      const arr = JSON.parse(localStorage.getItem(Keys.USER_DIVISI) || '[]');
      if (Array.isArray(arr) && arr.length) divisiCsv = arr.join(',');
    }catch(_){}
  }

  // >>> penting: merge nik_auth & token ke semua request
  return { ..._auth(), ...params, role, nik, ...(divisiCsv ? { divisi: divisiCsv } : {}) };
}

async function _fetchJSON(params){
  const qs  = new URLSearchParams(params);
  const url = `${BASE_URL}?${qs.toString()}`;

  // Guard: bila payload terlalu besar, sarankan POST (belum diaktifkan)
  if (url.length > 7000) {
    throw new Error('Payload terlalu besar untuk GET. Pertimbangkan POST (form-encoded) + doPost di GAS.');
  }

  const res = await fetch(url, { method:'GET', credentials:'omit', cache:'no-store' });
  if (!res.ok) throw new Error('Network error '+res.status);
  return res.json();
}

export const API = {
  // expose untuk dicek di UI (settings.js)
  baseUrl: BASE_URL,

  // AUTH
  async login({ nik, pass_hash, role }) {
    // login memang tidak butuh nik_auth/token
    return _fetchJSON({ route:'auth.login', nik, pass_hash, role });
  },

  // USER MGMT (server wajib guard admin)
  async userAdd({ nik, name, role, pass_hash }) {
    return _fetchJSON(sessionAttach({ route:'user.add', nik, name, role, pass_hash }));
  },
  async userReset({ nik, pass_hash }) {
    return _fetchJSON(sessionAttach({ route:'user.reset', nik, pass_hash }));
  },
  async userList()  {
    return _fetchJSON(sessionAttach({ route:'user.list' }));
  },
  async userDelete({ nik }) {
    return _fetchJSON(sessionAttach({ route:'user.delete', nik }));
  },

  // MASTER
  async masterPull(params = {}) {
    return _fetchJSON(sessionAttach({ route:'master.pull', ...params }));
  },
  async masterPush({ items }) {
    return _fetchJSON(sessionAttach({ route:'master.push', payload: JSON.stringify(items || {}) }));
  },

  // DATA AKTUAL
  async actualPull({ month, year } = {}) {
    return _fetchJSON(sessionAttach({ route:'actual.pull', month, year }));
  },

  // PUSINGAN
  async pushInsert({ record }) {
    return _fetchJSON(sessionAttach({ route:'pusingan.insert', payload: JSON.stringify(record) }));
  },
  async pushUpdate({ key, record }) {
    return _fetchJSON(sessionAttach({ route:'pusingan.update', key, payload: JSON.stringify(record) }));
  },
  async checkKey({ key }) {
    return _fetchJSON(sessionAttach({ route:'pusingan.check', key }));
  },

  // OFFLINE → ONLINE: bulk sync (pastikan endpoint tersedia di GAS bila ingin dipakai)
  async syncBulk({ records }) {
    return _fetchJSON(sessionAttach({ route:'sync.bulk', payload: JSON.stringify(records || []) }));
  },
};
