// core/utils.js

// DOM helpers
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Date helpers
export function fmtDateISO(d = new Date()){
  const tzOff = d.getTimezoneOffset();
  const t = new Date(d.getTime() - tzOff * 60000);
  return t.toISOString().slice(0, 10);
}
export function nowISO(){ return new Date().toISOString(); }

// Number/hash/currency
export function ensureNumber(v, def = 0){ const n = Number(v); return Number.isFinite(n) ? n : def; }
// Simple stable hash (FNV-1a)
export function hash(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = (h + (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24)) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}
export function rupiah(n){
  try { return new Intl.NumberFormat('id-ID').format(n); }
  catch(_) { return String(n); }
}

// ---- LocalStorage safe helpers (tanpa import Keys agar hindari circular) ----
export function getLS(key, fallback = null){
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch(_) { return fallback; }
}
export function safeJSONParse(str, fallback){
  try { return JSON.parse(str); } catch(_) { return fallback; }
}

// Session helpers (kompatibel dengan kunci lama/baru)
export function getSessionRole(){
  // urutan fallback: session.role → pp2:session.role → role
  return (
    getLS('session.role') ||
    getLS('pp2:session.role') ||
    getLS('role') ||
    '-'
  );
}
export function getSessionDivisi(){
  // dukung array JSON pada salah satu key berikut
  const raw =
    getLS('session.divisi') ||
    getLS('pp2:session.divisi') ||
    '[]';
  const arr = safeJSONParse(raw, []);
  return Array.isArray(arr) ? arr : [];
}
export function isOnline(){ return (typeof navigator !== 'undefined') ? navigator.onLine : true; }
export function isAdminRole(role){ return String(role || '').toLowerCase() === 'admin'; }

// UI: tampilkan badge + toggle menu admin
export function loadSessionRoleBadge(){
  const role = getSessionRole() || '-';
  const el = document.getElementById('role-badge');
  if (el) el.textContent = `Role: ${role}`;

  // Sekalian guard menu admin bila elemen ada
  const menuAdmin = document.getElementById('menu-user-manage');
  if (menuAdmin) {
    menuAdmin.style.display = isAdminRole(role) ? '' : 'none';
  }
}
