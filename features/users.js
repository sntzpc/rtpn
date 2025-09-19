// =====================
// File: features/users.js
// Halaman Admin: Kelola User (CRUD ringan + export CSV)
// =====================
import { $ } from '../core/utils.js';
import { API } from '../core/api.js';
import { Keys } from '../core/storage.js';

// ---- util kecil ----
function safeSpinner(on){
  try { if (typeof spinner === 'function') spinner(!!on); } catch(_) {}
}
async function confirmDialog(msg){
  try { return !!window.confirm(msg); } catch { return false; }
}
function hashPlain(p){
  let h = 0; for (let i=0;i<p.length;i++){ h = (h*31 + p.charCodeAt(i))|0; }
  return String(h>>>0);
}
function isAdmin(){
  return String(localStorage.getItem(Keys.ROLE)||'').toLowerCase() === 'admin';
}
function authParams(){
  return {
    nik_auth: localStorage.getItem(Keys.NIK)   || '',
    token:    localStorage.getItem(Keys.TOKEN) || ''
  };
}

// ---- state UI ----
let USERS = [];
let PAGE = 1;
let SIZE = 20;
let Q = '';
let ROLE_FILTER = 'all';
let STATUS_FILTER = 'all';
let SORT_BY = 'nik';     // nik|name|role|status
let SORT_DIR = 'asc';    // asc|desc

// ---- view ----
function view(){
  return `
  <div class="card">
    <div class="row" style="align-items:center;gap:10px;justify-content:space-between">
      <h2 style="margin:0">Kelola User</h2>
<div class="ribbon tools">
  <button id="btn-refresh" class="icon-btn" title="Muat ulang" aria-label="Muat ulang">
    <!-- refresh -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.65 6.35A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L14 8h6V2l-2.34 2.34z"/>
    </svg>
    <span class="sr-only">Refresh</span>
  </button>
  <button id="btn-export" class="icon-btn" title="Export CSV" aria-label="Export CSV">
    <!-- download -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v10.59l3.3-3.3 1.4 1.42L12 17.41l-4.7-4.7 1.4-1.42 3.3 3.3V3h2zM5 19h14v2H5z"/>
    </svg>
    <span class="sr-only">Export CSV</span>
  </button>
  <button id="btn-add" class="icon-btn primary" title="Tambah User" aria-label="Tambah User">
    <!-- plus -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>
    </svg>
    <span class="sr-only">Tambah User</span>
  </button>
</div>
    </div>
    <div id="user-stats" style="margin-top:6px"></div>
  </div>

  <div class="card">
    <div class="row" style="gap:8px;align-items:flex-end">
      <div class="col">
        <label>Cari</label>
        <input id="u-search" placeholder="NIK / Nama"/>
      </div>
      <div class="col">
        <label>Role</label>
        <select id="u-role-filter">
          <option value="all">Semua</option>
          <option value="admin">Admin</option>
          <option value="asisten">Asisten</option>
          <option value="mandor">Mandor</option>
        </select>
      </div>
      <div class="col">
        <label>Status</label>
        <select id="u-status-filter">
          <option value="all">Semua</option>
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
      </div>
      <div class="col">
        <label>Tampil</label>
        <select id="u-size">
          <option value="20" selected>20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="1000">1000</option>
        </select>
      </div>
    </div>
  </div>

  <div class="card">
    <div id="u-table"></div>
    <div id="u-pager" style="margin-top:8px"></div>
  </div>

  <style>
    #u-table .num{ text-align:right; }
    #u-table th.sortable{ cursor:pointer; user-select:none; }
    #u-table th.sortable .dir{ opacity:.6; font-weight:700; margin-left:4px; }
    #u-pager .pager-bar{ display:flex; gap:6px; align-items:center; white-space:nowrap; }
    #u-pager .pager-btn{
      padding:4px 10px; border:1px solid var(--border); background:var(--table-cell-bg);
      border-radius:6px; cursor:pointer; line-height:1; font-size:12px;
    }
    #u-pager .pager-btn.active{ background:var(--primary); color:#fff; border-color:var(--primary); }
    #u-pager .pager-btn[disabled]{ opacity:.45; cursor:not-allowed; }
    #u-pager .pager-ellipsis{ padding:0 4px; color:var(--muted); }

    /* modal add */
    .modal-wrap{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.4); z-index:1000; }
    .modal-card{ width:min(560px, 95vw); background:var(--card-bg); color:var(--text); border:1px solid var(--border);
      border-radius:12px; padding:14px; box-shadow:0 10px 30px rgba(0,0,0,.25); }
    .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    @media (max-width:560px){ .grid2{ grid-template-columns: 1fr; } }
  </style>
  `;
}

// ---- data fetch ----
async function loadUsers(){
  safeSpinner(true);
  try{
    const res = await API.userList(authParams());
    if (!res?.ok) throw new Error(res?.error || 'Gagal memuat user');
    USERS = Array.isArray(res.data?.users) ? res.data.users : [];
  }catch(e){
    console.error(e);
    USERS = [];
    showToast(e.message || 'Gagal memuat user');
  }finally{
    safeSpinner(false);
  }
}

// ---- filter/sort/paging ----
function filteredUsers(){
  let rows = USERS.slice();
  const qq = (Q||'').trim().toLowerCase();
  if (qq){
    rows = rows.filter(u =>
      String(u.nik||'').toLowerCase().includes(qq) ||
      String(u.name||'').toLowerCase().includes(qq)
    );
  }
  if (ROLE_FILTER !== 'all'){
    rows = rows.filter(u => String(u.role||'').toLowerCase() === ROLE_FILTER);
  }
  if (STATUS_FILTER !== 'all'){
    rows = rows.filter(u => String(u.status||'active').toLowerCase() === STATUS_FILTER);
  }

  rows.sort((a,b)=>{
    const pick = (u)=>{
      if (SORT_BY==='nik') return String(u.nik||'');
      if (SORT_BY==='name') return String(u.name||'');
      if (SORT_BY==='role') return String(u.role||'');
      return String(u.status||'');
    };
    const A = pick(a), B = pick(b);
    if (A===B) return 0;
    const cmp = (A > B) ? 1 : -1;
    return (SORT_DIR==='asc') ? cmp : -cmp;
  });

  return rows;
}

function renderStats(){
  const total = USERS.length;
  const byRole = USERS.reduce((m,u)=>{
    const r = String(u.role||'').toLowerCase() || '-';
    m[r] = (m[r]||0)+1;
    return m;
  }, {});

  const items = [
    {label:'Total',   val: total},
    {label:'admin',   val: byRole['admin']   || 0},
    {label:'asisten', val: byRole['asisten'] || 0},
    {label:'mandor',  val: byRole['mandor']  || 0},
  ];

  $('#user-stats').innerHTML = `
    <div class="ribbon chips">
      ${items.map(x=>`<span class="chip">${x.label}: <b>${x.val}</b></span>`).join('')}
    </div>`;
}

// ---- table + pager ----
let _pages = 1;
function renderTable(){
  const data = filteredUsers();
  _pages = Math.max(1, Math.ceil(data.length / SIZE));
  if (PAGE > _pages) PAGE = _pages;
  const start = (PAGE-1)*SIZE;
  const pageRows = data.slice(start, start+SIZE);

  $('#u-table').innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th class="sortable" data-sort="nik">NIK <span class="dir">${SORT_BY==='nik'?(SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="name">Nama <span class="dir">${SORT_BY==='name'?(SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="role">Role <span class="dir">${SORT_BY==='role'?(SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="status">Status <span class="dir">${SORT_BY==='status'?(SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="aksi">Aksi</th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map(u=>`
          <tr>
            <td>${u.nik}</td>
            <td>${u.name||''}</td>
            <td>${u.role||''}</td>
            <td>${u.status||'active'}</td>
            <td class="aksi">
              <div class="cell-actions">
                <button data-action="passwd" data-nik="${u.nik}">Ubah Pass</button>
                <button data-action="delete" data-nik="${u.nik}" class="danger">Hapus</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // sort header
  document.querySelectorAll('#u-table th.sortable').forEach(th=>{
    th.onclick = ()=>{
      const k = th.getAttribute('data-sort');
      if (SORT_BY === k) SORT_DIR = (SORT_DIR === 'asc' ? 'desc' : 'asc');
      else { SORT_BY = k; SORT_DIR = 'asc'; }
      renderTable();
    };
  });

  renderPager();
}

function renderPager(){
  const el = $('#u-pager');
  const clamp = (n)=> Math.max(1, Math.min(_pages, n));
  const btn = (label, target, {active=false, disabled=false}={}) =>
    `<button class="pager-btn ${active?'active':''}" ${disabled?'disabled':''} data-go="${disabled?'':target}">${label}</button>`;
  const dots = `<span class="pager-ellipsis">…</span>`;

  const parts = [];
  parts.push(btn('‹', clamp(PAGE-1), {disabled: PAGE<=1}));

  if (_pages <= 7){
    for (let i=1;i<=_pages;i++) parts.push(btn(String(i), i, {active: i===PAGE}));
  }else{
    parts.push(btn('1', 1, {active: PAGE===1}));
    if (PAGE > 3) parts.push(dots);
    const start = Math.max(2, PAGE-1);
    const end   = Math.min(_pages-1, PAGE+1);
    for (let i=start;i<=end;i++) parts.push(btn(String(i), i, {active: i===PAGE}));
    if (PAGE < _pages-2) parts.push(dots);
    parts.push(btn(String(_pages), _pages, {active: PAGE===_pages}));
  }

  parts.push(btn('›', clamp(PAGE+1), {disabled: PAGE>=_pages}));

  el.innerHTML = `<div class="pager-bar">${parts.join('')}</div>`;
  el.querySelectorAll('.pager-btn[data-go]').forEach(b=>{
    const target = Number(b.getAttribute('data-go'));
    if (!isNaN(target) && target>0){
      b.addEventListener('click', ()=>{ PAGE = target; renderTable(); });
    }
  });
}

// ---- export ----
function exportCSV(){
  const rows = filteredUsers(); // tanpa paging
  const header = ['nik','name','role','status'];
  const esc = (v)=> `"${String(v??'').replace(/"/g,'""')}"`;
  const lines = [
    header.join(','),
    ...rows.map(u=> [u.nik, u.name||'', u.role||'', u.status||'active'].map(esc).join(','))
  ];
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `users-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- modal add ----
function openAddModal(){
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal-card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">Tambah User</h3>
        <button id="m-close">Tutup</button>
      </div>
      <div class="grid2" style="margin-top:8px">
        <div>
          <label>NIK</label>
          <input id="m-nik" placeholder="NIK"/>
        </div>
        <div>
          <label>Nama</label>
          <input id="m-nama" placeholder="Nama (opsional)"/>
        </div>
        <div>
          <label>Role</label>
          <select id="m-role">
            <option value="mandor">Mandor</option>
            <option value="asisten">Asisten</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label>Password (opsional)</label>
          <input id="m-pass" type="password" placeholder="default: user123"/>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end; gap:8px; margin-top:10px">
        <button class="primary" id="m-save">Simpan</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = ()=> wrap.remove();
  wrap.querySelector('#m-close').addEventListener('click', close);

  wrap.querySelector('#m-save').addEventListener('click', async ()=>{
    const nik  = (wrap.querySelector('#m-nik').value || '').trim();
    const name = (wrap.querySelector('#m-nama').value || '').trim() || nik;
    const role = wrap.querySelector('#m-role').value || 'mandor';
    const pass = wrap.querySelector('#m-pass').value || 'user123';
    if (!nik) { showToast('NIK wajib diisi'); return; }

    try{
      safeSpinner(true);
      const pass_hash = hashPlain(pass);
      const res = await API.userAdd({ nik, name, role, pass_hash, ...authParams() });
      if (!res?.ok) throw new Error(res?.error || 'Gagal tambah user');
      showToast('User disimpan');
      close();
      await reloadAndRender();
    }catch(e){
      showToast(e.message || 'Gagal tambah user');
    }finally{
      safeSpinner(false);
    }
  });
}

// ---- actions ----
function bindActions(){
  // table actions (delegation)
  $('#u-table').addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const nik = btn.getAttribute('data-nik');

    if (action === 'passwd'){
      const newPass = prompt(`Masukkan password baru untuk NIK ${nik} (kosongkan untuk 'user123'):`) || 'user123';
      try{
        safeSpinner(true);
        const pass_hash = hashPlain(newPass);
        const res = await API.userReset({ nik, pass_hash, ...authParams() });
        if (!res?.ok) throw new Error(res?.error || 'Gagal ubah password');
        showToast('Password diperbarui');
      }catch(e){
        showToast(e.message || 'Gagal ubah password');
      }finally{
        safeSpinner(false);
      }
    }

    if (action === 'delete'){
      const ok = await confirmDialog(`Hapus user NIK ${nik}? Tindakan ini tidak dapat dibatalkan.`);
      if (!ok) return;
      try{
        safeSpinner(true);
        const res = await API.userDelete({ nik, ...authParams() });
        if (!res?.ok) throw new Error(res?.error || 'Gagal hapus user');
        showToast('User dihapus');
        await reloadAndRender();
      }catch(e){
        showToast(e.message || 'Gagal hapus user');
      }finally{
        safeSpinner(false);
      }
    }
  });

  // top bar
  $('#btn-refresh').addEventListener('click', reloadAndRender);
  $('#btn-export').addEventListener('click', exportCSV);
  $('#btn-add').addEventListener('click', openAddModal);

  // filters
  $('#u-search').addEventListener('input', (e)=>{ Q = e.target.value||''; PAGE=1; renderTable(); });
  $('#u-role-filter').addEventListener('change', (e)=>{ ROLE_FILTER = e.target.value||'all'; PAGE=1; renderTable(); });
  $('#u-status-filter').addEventListener('change', (e)=>{ STATUS_FILTER = e.target.value||'all'; PAGE=1; renderTable(); });
  $('#u-size').addEventListener('change', (e)=>{ SIZE = +e.target.value||20; PAGE=1; renderTable(); });
}

async function reloadAndRender(){
  await loadUsers();
  renderStats();
  renderTable();
}

// ---- entry ----
export async function render(app){
  if (!isAdmin()){
    app.innerHTML = `
      <div class="card">
        <h2>Akses Ditolak</h2>
        <p>Halaman ini khusus <b>Admin</b>.</p>
      </div>`;
    return;
  }

  app.innerHTML = view();
  bindActions();
  await reloadAndRender();
}
