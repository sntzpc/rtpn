// --- DEBUG (sementara, untuk memastikan file ini yang ter-load) ---
console.log('[sync-view] loaded @', new Date().toISOString());

// =====================
// File: features/sync-view.js
// =====================
import { $ } from '../core/utils.js';
import { Keys, LStore } from '../core/storage.js';
import { SyncState, getRecord, serverKeyOf, listRecords } from '../core/sync.js';
import { API } from '../core/api.js';
import { Progress } from '../core/progress.js';

function _blokNameById(id){
  const list = LStore.getArr(Keys.MASTER_BLOK) || [];
  const b = list.find(x => String(x.id) === String(id));
  return b ? (b.nama || b.kode || b.id) : (id || '');
}
function _f2(n){ const v = Number(n); return Number.isFinite(v) ? v.toFixed(2) : ''; }

// state tampilan tabel
let SV_PAGE = 1;
let SV_SIZE = 20;
let SV_Q = '';
let SV_SORT_BY = 'tanggal'; // tanggal|divisi_id|_blokName
let SV_SORT_DIR = 'desc';

const SV_STATE_KEY = 'syncView.state.v1';

function _saveState(){
  try{
    const state = {
      page: SV_PAGE,
      size: SV_SIZE,
      q: SV_Q,
      sortBy: SV_SORT_BY,
      sortDir: SV_SORT_DIR,
      filter: ($('#f-status')?.value || 'all')
    };
    localStorage.setItem(SV_STATE_KEY, JSON.stringify(state));
  }catch(_){}
}

function _loadState(){
  try{
    const s = JSON.parse(localStorage.getItem(SV_STATE_KEY) || '{}');
    SV_PAGE     = s.page    || 1;
    SV_SIZE     = s.size    || 20;
    SV_Q        = s.q       || '';
    SV_SORT_BY  = s.sortBy  || 'tanggal';
    SV_SORT_DIR = s.sortDir || 'desc';
    // set kontrol UI (kalau elemennya sudah ada)
    const f = $('#f-status');   if (f && s.filter) f.value = s.filter;
    const si = $('#sv-size');   if (si) si.value = String(SV_SIZE);
    const q  = $('#sv-search'); if (q)  q.value  = SV_Q;
  }catch(_){}
}

let SV_BUSY = false;
function _setBusyUI(busy){
  SV_BUSY = !!busy;
  ['#btn-sync-all','#btn-sync-selected'].forEach(sel=>{
    const el = $(sel); if (el) el.disabled = SV_BUSY;
  });
  // disable checkbox + tombol aksi di tabel
  document.querySelectorAll('#sync-table button, #sync-table input[type="checkbox"]').forEach(el=>{
    el.disabled = SV_BUSY;
  });
}

function _getFilteredSortedRows(){
  const filter = $('#f-status')?.value || 'all';
  const q = (SV_Q||'').trim().toLowerCase();
  let rows = _getSyncRows(filter);

  if (q){
    rows = rows.filter(r =>
      (r.tanggal||'').toLowerCase().includes(q) ||
      String(r.divisi_id||'').toLowerCase().includes(q) ||
      String(r._blokName||'').toLowerCase().includes(q)
    );
  }

  rows.sort((a,b)=>{
    const A = (SV_SORT_BY==='tanggal') ? a.tanggal
            : (SV_SORT_BY==='divisi_id') ? String(a.divisi_id||'')
            : String(a._blokName||'');
    const B = (SV_SORT_BY==='tanggal') ? b.tanggal
            : (SV_SORT_BY==='divisi_id') ? String(b.divisi_id||'')
            : String(b._blokName||'');
    if (A===B) return 0;
    const cmp = (A>B) ? 1 : -1;
    return SV_SORT_DIR==='asc' ? cmp : -cmp;
  });
  return rows;
}

function _exportCSV(){
  const rows = _getFilteredSortedRows(); // tanpa paging
  const header = ['local_id','status','tanggal','divisi','blok','jjg','hk','tonase'];
  const esc = (v)=> `"${String(v??'').replace(/"/g,'""')}"`;
  const lines = [
    header.join(','),
    ...rows.map(r=>[
      r.local_id,
      r.sync_status,
      r.tanggal||'',
      r.divisi_id||'',
      r._blokName||'',
      _f2(r.jjg),
      _f2(r.hk),
      _f2(r.tonase_ton)
    ].map(esc).join(','))
  ];
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sync-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}


function view(){
  return `
  <div class="card">
    <h2>Sinkronisasi (sync-view.js)</h2>

    <div class="card sync-status" id="sync-status"></div>

    <div class="row" style="margin-top:8px; gap:8px">
      <div class="col">
        <button class="primary" id="btn-sync-all">Sinkron Semua</button>
      </div>
      <div class="col">
        <button id="btn-sync-selected">Sinkron Terpilih</button>
      </div>
       <div class="col">
        <button id="btn-export">Export CSV (Filter)</button>
     </div>
      <div class="col">
        <label>Filter Status</label>
        <select id="f-status">
          <option value="all">Semua</option>
          <option value="pending">Pending</option>
          <option value="edited">Edited</option>
          <option value="synced">Synced</option>
        </select>
      </div>

      <div class="col">
        <label>Cari</label>
        <input id="sv-search" placeholder="Tanggal / Divisi / Blok"/>
      </div>
      <div class="col">
        <label>Tampil</label>
        <select id="sv-size">
          <option value="20" selected>20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="1000">1000</option>
        </select>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>Antrian & Riwayat</h3>
    <div id="sync-table"></div>
    <div id="sync-pager" style="margin-top:8px;"></div>
  </div>

  <style>
    /* pager */
    #sync-pager .pager-bar{ display:flex; gap:6px; align-items:center; white-space:nowrap; }
    #sync-pager .pager-btn{
      padding:4px 10px; border:1px solid var(--border); background:var(--table-cell-bg);
      border-radius:6px; cursor:pointer; line-height:1; font-size:12px;
    }
    #sync-pager .pager-btn.active{ background:var(--primary); color:#fff; border-color:var(--primary); }
    #sync-pager .pager-btn[disabled]{ opacity:.45; cursor:not-allowed; }
    #sync-pager .pager-ellipsis{ padding:0 4px; color:var(--muted); }

    /* angka kanan */
    #sync-table .num{ text-align:right; }

    /* header tombol sorting (opsional) */
    #sync-table th.sortable{ cursor:pointer; user-select:none; }
    #sync-table th.sortable .dir{ opacity:.6; font-weight:700; margin-left:4px; }
  </style>
  `;
}

function statusIcon(st){
  return st==='synced' ? '✅' : (st==='edited' ? '⭕' : '⬜'); // ⬜ = pending
}

function computeStats(){
  const rows = LStore.getArr(Keys.INPUT_RECORDS);
  const total = rows.length;
  const pending = rows.filter(r=>r.sync_status==='pending').length;
  const edited  = rows.filter(r=>r.sync_status==='edited').length;
  const synced  = rows.filter(r=>r.sync_status==='synced').length;
  return { total, pending, edited, synced };
}

function _getSyncRows(filter='all'){
  let rows = (LStore.getArr(Keys.INPUT_RECORDS) || []).slice();

  if (filter && filter !== 'all'){
    rows = rows.filter(r => r.sync_status === filter);
  }

  // map untuk tampilan
  return rows.map(r => ({
    ...r,
    _blokName: _blokNameById(r.blok_id)
  }));
}

function _renderPager(container, page, pages){
  const clamp = (n)=> Math.max(1, Math.min(pages, n));
  const btn = (label, target, {active=false, disabled=false}={}) =>
    `<button class="pager-btn ${active?'active':''}" ${disabled?'disabled':''} data-go="${disabled?'':target}">${label}</button>`;
  const dots = `<span class="pager-ellipsis">…</span>`;

  const parts = [];
  // prev
  parts.push(btn('‹', clamp(page-1), {disabled: page<=1}));

  if (pages <= 7){
    for (let i=1;i<=pages;i++) parts.push(btn(String(i), i, {active: i===page}));
  }else{
    // 1 … (page-1, page, page+1) … last
    parts.push(btn('1', 1, {active: page===1}));
    if (page > 3) parts.push(dots);

    const start = Math.max(2, page-1);
    const end   = Math.min(pages-1, page+1);
    for (let i=start; i<=end; i++) parts.push(btn(String(i), i, {active: i===page}));

    if (page < pages-2) parts.push(dots);
    parts.push(btn(String(pages), pages, {active: page===pages}));
  }

  // next
  parts.push(btn('›', clamp(page+1), {disabled: page>=pages}));

  container.innerHTML = `<div class="pager-bar">${parts.join('')}</div>`;
  container.querySelectorAll('.pager-btn[data-go]').forEach(b=>{
    const target = Number(b.getAttribute('data-go'));
    if (!isNaN(target) && target>0){
      b.addEventListener('click', ()=>{
        SV_PAGE = target;
        renderSyncTable();
        _saveState();
      });
    }
  });
}


// cache pages count untuk tombol next/prev
let _lastPages = 1;

function renderSyncTable(){
  const filter = $('#f-status').value || 'all';
  const q = (SV_Q||'').trim().toLowerCase();
  let rows = _getSyncRows(filter);

  // search
  if (q){
    rows = rows.filter(r =>
      (r.tanggal||'').toLowerCase().includes(q) ||
      String(r.divisi_id||'').toLowerCase().includes(q) ||
      String(r._blokName||'').toLowerCase().includes(q)
    );
  }

  // sort
  rows.sort((a,b)=>{
    const A = (SV_SORT_BY==='tanggal') ? a.tanggal
            : (SV_SORT_BY==='divisi_id') ? String(a.divisi_id||'')
            : String(a._blokName||'');
    const B = (SV_SORT_BY==='tanggal') ? b.tanggal
            : (SV_SORT_BY==='divisi_id') ? String(b.divisi_id||'')
            : String(b._blokName||'');
    if (A===B) return 0;
    const cmp = (A>B) ? 1 : -1;
    return SV_SORT_DIR==='asc' ? cmp : -cmp;
  });

  // paging
  const total = rows.length;
  _lastPages = Math.max(1, Math.ceil(total / SV_SIZE));
  if (SV_PAGE > _lastPages) SV_PAGE = _lastPages;
  const start = (SV_PAGE-1) * SV_SIZE;
  const pageRows = rows.slice(start, start+SV_SIZE);

  // render
  $('#sync-table').innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th><input type="checkbox" id="ck-all"/></th>
          <th>Status</th>
          <th class="sortable" data-sort="tanggal">Tanggal <span class="dir">${SV_SORT_BY==='tanggal'?(SV_SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="divisi_id">Divisi <span class="dir">${SV_SORT_BY==='divisi_id'?(SV_SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="_blokName">Blok <span class="dir">${SV_SORT_BY==='_blokName'?(SV_SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
          <th class="num">JJG</th><th class="num">HK</th><th class="num">Tonase</th>
          <th class="aksi">Aksi</th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map(r=>`
          <tr>
            <td><input type="checkbox" class="ck" data-id="${r.local_id}"/></td>
            <td>${statusIcon(r.sync_status)}</td>
            <td>${r.tanggal||''}</td>
            <td>${r.divisi_id||''}</td>
            <td>${r._blokName||''}</td>
            <td class="num">${_f2(r.jjg)}</td>
            <td class="num">${_f2(r.hk)}</td>
            <td class="num">${_f2(r.tonase_ton)}</td>
            <td class="aksi">
              <div class="cell-actions">
                <button data-edit="${r.local_id}">Edit</button>
                <button data-push="${r.local_id}" class="primary">Push</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // header sort
  $('#sync-table').querySelectorAll('th.sortable').forEach(th=>{
    th.onclick = ()=>{
      const k = th.getAttribute('data-sort');
      if (SV_SORT_BY === k) SV_SORT_DIR = (SV_SORT_DIR==='asc' ? 'desc' : 'asc');
      else { SV_SORT_BY = k; SV_SORT_DIR = (k==='tanggal' ? 'desc' : 'asc'); }
      SV_PAGE = 1;
      renderSyncTable();
      _saveState();
    };
  });

  // pager
  _renderPager($('#sync-pager'), SV_PAGE, _lastPages);

  // attach row handlers seperti biasa
  attachRowHandlers();
}


async function pushOne(rec){
  // Cek koneksi
  if (!navigator.onLine) throw new Error('Tidak ada koneksi internet');
  const key = serverKeyOf(rec);
  const exists = await API.checkKey({ key });

  if (exists && exists.ok && exists.data && exists.data.exists){
    const res = await API.pushUpdate({ key, record:rec });
    if (!res.ok) throw new Error(res.error||'Gagal update');
    if (res.data && res.data.server_id) rec.server_id = res.data.server_id;
  } else {
    const res = await API.pushInsert({ record:rec });
    if (!res.ok) throw new Error(res.error||'Gagal insert');
    if (res.data && res.data.server_id) rec.server_id = res.data.server_id;
  }
  // Sukses → tandai synced
  rec.sync_status='synced';
  // Simpan ke lokal
  const list = LStore.getArr(Keys.INPUT_RECORDS);
  const idx = list.findIndex(r=>r.local_id===rec.local_id);
  if (idx>=0){ list[idx]=rec; LStore.setArr(Keys.INPUT_RECORDS, list); }
  // Keluarkan dari antrian
  SyncState.dequeue(rec.local_id);
}

async function pushMany(ids){
  if (!ids || !ids.length){ showToast('Tidak ada data'); return; }
  _setBusyUI(true);
  Progress.open({ title:'Sinkronisasi data', subtitle:'Menyiapkan…', total: ids.length });
  let i = 0;
  for (const id of ids){
    i++;
    const rec = getRecord(id);
    Progress.update(`Menyinkron: ${rec?.local_id || id}`);
    try{
      await pushOne(rec);
      showToast(`OK: ${rec.local_id}`);
    }catch(e){
      showToast(`ERR: ${e.message||'gagal'}`);
    }finally{
      Progress.tick(i, ids.length);
    }
  }
  Progress.update('Selesai');
  Progress.close();
  _setBusyUI(false);
}


function refresh(){
  renderSyncTable();
  renderSyncRibbon();
}


function attachRowHandlers(){
  // Master checkbox
  const ckAll = $('#ck-all');
  if (ckAll){
    ckAll.addEventListener('change', ()=>{
      document.querySelectorAll('#sync-table .ck').forEach(ck=> ck.checked = ckAll.checked);
    });
  }

  // Edit → ke halaman input (mode edit)
  $('#sync-table').querySelectorAll('button[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-edit');
      sessionStorage.setItem('edit.local_id', id);
      location.hash = '#/input';
    });
  });

  // Push satu baris
  $('#sync-table').querySelectorAll('button[data-push]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-push');
      const rec = getRecord(id);
      if (!rec) return;
      try{
        _setBusyUI(true);
        Progress.open({ title:'Sinkronisasi 1 data', total: 1, subtitle: rec?.local_id || id });
        await pushOne(rec);
        showToast('Sinkron sukses');
        Progress.tick(1,1);
      }catch(e){
        showToast(e.message||'Gagal sinkron');
      }finally{
        Progress.close();
        _setBusyUI(false);
        refresh();            // ini sekaligus memanggil renderSyncRibbon()
      }
    });
  });
}


function getSyncStats(){
  const list = LStore.getArr(Keys.INPUT_RECORDS) || [];
  const total   = list.length;
  const pending = list.filter(r=>r.sync_status==='pending').length;
  const edited  = list.filter(r=>r.sync_status==='edited').length;
  const synced  = list.filter(r=>r.sync_status==='synced').length;
  const online  = navigator.onLine;
  return { total, pending, edited, synced, online };
}

function renderSyncRibbon(){
  const el = document.getElementById('sync-status');
  if (!el) return;
  const { total, pending, edited, synced, online } = getSyncStats();
  el.innerHTML = `
    <div class="ribbon">
      <div class="item"><span class="sync-dot ${online?'online':'offline'}"></span>${online?'Online':'Offline'}</div>
      <div class="item">Total: <b>${total}</b></div>
      <div class="item">Pending: <b>${pending}</b></div>
      <div class="item">Edited: <b>${edited}</b></div>
      <div class="item">Synced: <b>${synced}</b></div>
    </div>
  `;
}

function bind(app){
  // Render awal
  SV_PAGE = 1;           // state pager (global yg sudah kita definisikan)
  SV_SIZE = 20;
  SV_Q = '';
  SV_SORT_BY = 'tanggal';
  SV_SORT_DIR = 'desc';

  _loadState();
  renderSyncTable();     // gambar tabel + pager + handler baris
  renderSyncRibbon();    // ribbon status atas

  // ===== Events =====

  // Filter status → refresh tabel
  $('#f-status').addEventListener('change', ()=>{
    SV_PAGE = 1;
    renderSyncTable();
    renderSyncRibbon();
    _saveState();
  });

  // Search
  const elSearch = $('#sv-search');
  if (elSearch){
    elSearch.addEventListener('input', (e)=>{
      SV_Q = e.target.value || '';
      SV_PAGE = 1;
      renderSyncTable();
      _saveState();
    });
  }

  // Page size
  const elSize = $('#sv-size');
  if (elSize){
    elSize.addEventListener('change', (e)=>{
      SV_SIZE = +e.target.value || 20;
      SV_PAGE = 1;
      renderSyncTable();
      _saveState();
    });
  }

  // Sync semua
  $('#btn-sync-all').addEventListener('click', async ()=>{
    const targets = (LStore.getArr(Keys.INPUT_RECORDS)||[])
      .filter(r=> r.sync_status!=='synced')
      .map(r=> r.local_id);
    if (!targets.length) return showToast('Tidak ada item untuk disinkron');
    await pushMany(targets);
    renderSyncTable();
    renderSyncRibbon();
  });

  // Sync terpilih
  $('#btn-sync-selected').addEventListener('click', async ()=>{
    const ids = Array.from(document.querySelectorAll('#sync-table .ck'))
      .filter(ck=> ck.checked)
      .map(ck=> ck.getAttribute('data-id'));
    if (!ids.length) return showToast('Pilih data terlebih dulu');
    await pushMany(ids);
    renderSyncTable();
    renderSyncRibbon();
  });

  // Export CSV
 const btnExp = $('#btn-export');
 if (btnExp){
   btnExp.addEventListener('click', _exportCSV);
 }

  // Online/offline → update ribbon
  window.addEventListener('online',  renderSyncRibbon);
  window.addEventListener('offline', renderSyncRibbon);
}



export function render(app){ app.innerHTML = view(); bind(app); }
