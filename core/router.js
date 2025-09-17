// =====================
// File: core/router.js
// =====================
import { $, $$ } from './utils.js';
import { Keys } from './storage.js';
import { applyTheme, mountThemeToggle } from './theme.js';

// Cache-busting untuk dynamic import (ubah nilainya untuk memaksa reload modul)
const BUST = localStorage.getItem('pp2:cacheBust') || 'dev';
const withBust = (url) => `${url}${url.includes('?') ? '&' : '?'}v=${BUST}`;

// ---- Helpers RBAC ----
function getRole(){
  return (localStorage.getItem(Keys.ROLE) || '').toLowerCase();
}
function isAdmin(){ return getRole() === 'admin'; }

// ---- Migrasi session lama → kunci baru (sekali jalan saat refresh) ----
function migrateLegacySession(){
  const pairs = [
    ['pp2:session.role', Keys.ROLE],
    ['pp2:session.nik',  Keys.NIK],
    ['pp2:session.name', Keys.NAME],
    ['session.role',     Keys.ROLE], // sangat lama
  ];
  pairs.forEach(([oldKey, newKey])=>{
    const cur = localStorage.getItem(newKey);
    if (!cur){
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal) localStorage.setItem(newKey, oldVal);
    }
  });
}

// ---- Render identitas user aktif di header ----
export function refreshSessionUI(){
  migrateLegacySession();

  const role = (localStorage.getItem(Keys.ROLE) || '-').toLowerCase();
  const nik  = localStorage.getItem(Keys.NIK)  || '';
  const name = localStorage.getItem(Keys.NAME) || '';

  const elRole = document.getElementById('role-badge'); // wajib di layout
  const elUser = document.getElementById('user-badge'); // opsional
  const menuAdmin = document.getElementById('menu-user-manage');

  const roleLabel =
      role==='admin'   ? 'Admin'
    : role==='asisten' ? 'Asisten'
    : role==='mandor'  ? 'Mandor'
    : '-';

  const text = (role!=='-')
    ? `Aktif: ${roleLabel} — ${name || nik || 'Tanpa Nama'}${nik?` (${nik})`:''}`
    : 'Belum login';

  if (elRole) elRole.textContent = text;
  if (elUser) elUser.textContent = (name || nik || '');
  if (menuAdmin) menuAdmin.style.display = isAdmin() ? '' : 'none';
}

// ---- Util route ----
function currentRoute(){
  return (location.hash || '#/input').split('?')[0];
}

async function renderRoute(route, app){
  if (!app) return;
  app.innerHTML = '<div class="card"><p>Memuat…</p></div>';

  try{
    switch(route){
      case '#/input': {
        const mod = await import(/* @vite-ignore */ withBust('../features/input.js'));
        mod.render(app);
        break;
      }
      case '#/report': {
        const mod = await import(/* @vite-ignore */ withBust('../features/report.js'));
        mod.render(app);
        break;
      }
      case '#/sync': {
        const mod = await import(/* @vite-ignore */ withBust('../features/sync-view.js'));
        mod.render(app);
        break;
      }
      case '#/settings': {
        const mod = await import(/* @vite-ignore */ withBust('../features/settings.js'));
        mod.render(app);
        break;
      }
      case '#/stats': {
        const mod = await import(/* @vite-ignore */ withBust('../features/stats.js'));
        mod.render(app);
        break;
      }
      case '#/users': {
        if (!isAdmin()){
          app.innerHTML = `<div class="card">
            <h2>Akses ditolak</h2>
            <p>Halaman ini khusus <b>Admin</b>.</p>
          </div>`;
          break;
        }
        try{
          const mod = await import(/* @vite-ignore */ withBust('../features/users.js'));
          mod.render(app);
        }catch(err){
          app.innerHTML = `<div class="card">
            <h2>Halaman Users belum tersedia</h2>
            <pre style="white-space:pre-wrap">${err?.message || err}</pre>
          </div>`;
        }
        break;
      }
      default: {
        app.innerHTML = '<div class="card"><h2>Halaman tidak ditemukan</h2></div>';
      }
    }
  }catch(e){
    app.innerHTML = `
      <div class="card">
        <h2>Gagal memuat halaman</h2>
        <pre style="white-space:pre-wrap">${e && e.message ? e.message : e}</pre>
      </div>`;
  }finally{
    // Pastikan badge identitas selalu tersinkron setelah render
    refreshSessionUI();
  }
}

// ---- Init Router (dipanggil sekali dari index/main) ----
export async function initRouter(){
  const app = document.getElementById('app');
  if (!app) return;

  applyTheme();
  mountThemeToggle();

  window.addEventListener('storage', (e)=>{
    if (e.key === Keys.THEME) applyTheme();
  });

  // Render pertama
  refreshSessionUI();
  await renderRoute(currentRoute(), app);

  // Navigasi via hash
  window.addEventListener('hashchange', () => {
    renderRoute(currentRoute(), app);
  });

  // Jika session berubah dari tab lain → segarkan identitas
  window.addEventListener('storage', refreshSessionUI);

  // Pastikan saat DOM siap (beberapa layout men-set badge terlambat)
  document.addEventListener('DOMContentLoaded', refreshSessionUI);
  mountThemeToggle();  // aman, tidak akan dobel karena by id
  applyTheme();        // jaga-jaga jika CSS/DOM baru butuh reapply
}
