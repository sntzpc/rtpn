// =====================
// api.js (fixed & hardened)
// =====================

const DEFAULT_EXEC = 'https://script.google.com/macros/s/AKfycbzoLFM6swaTRS7jz0AT_i3udQTm6u8ZCFBPdiudkhon-f1BzDAj0BTyBhqZlM-P4oM8oA/exec';
const BASE_URL =
  (typeof window !== 'undefined' && window.GAS_BASE_URL ? window.GAS_BASE_URL : DEFAULT_EXEC);

// Sanity log (tidak memicu preflight)
if (BASE_URL.includes('/macros/echo')) {
  console.error('BASE_URL salah: gunakan URL Web App (/exec), bukan /macros/echo');
}
if (!BASE_URL.endsWith('/exec')) {
  console.warn('BASE_URL sebaiknya diakhiri dengan /exec (Web App).');
}

async function _fetchJSON(params){
  const qs  = new URLSearchParams(params);
  const url = `${BASE_URL}?${qs.toString()}`;

  // Guard: kalau payload sangat besar, pertimbangkan pindah ke POST + doPost
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
    return _fetchJSON({ route:'auth.login', nik, pass_hash, role });
  },

  // USER MGMT
  async userAdd({ nik, name, role, pass_hash }) {
    return _fetchJSON({ route:'user.add', nik, name, role, pass_hash });
  },
  async userReset({ nik, pass_hash }) {
    return _fetchJSON({ route:'user.reset', nik, pass_hash });
  },
  async userList()  { return _fetchJSON({ route:'user.list' }); },
  async userDelete({ nik }) { return _fetchJSON({ route:'user.delete', nik }); },

  // MASTER
  async masterPull({ role, nik }) { return _fetchJSON({ route:'master.pull', role, nik }); },
  async masterPush({ items })     { return _fetchJSON({ route:'master.push', payload: JSON.stringify(items) }); },

  // DATA AKTUAL
  async actualPull({ role, nik, month, year }) {
    return _fetchJSON({ route:'actual.pull', role, nik, month, year });
  },

  // PUSINGAN
  async pushInsert({ record }) { return _fetchJSON({ route:'pusingan.insert', payload: JSON.stringify(record) }); },
  async pushUpdate({ key, record }) { return _fetchJSON({ route:'pusingan.update', key, payload: JSON.stringify(record) }); },
  async checkKey({ key }) { return _fetchJSON({ route:'pusingan.check', key }); },
};