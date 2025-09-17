// =====================
// File: features/sync-view.js (bulk sync + fallback)
// =====================
import { $ } from '../core/utils.js';
import { Keys, LStore } from '../core/storage.js';
import { SyncState, getRecord } from '../core/sync.js';
import { API } from '../core/api.js';
import { Progress } from '../core/progress.js';

function _blokNameById(id){
  const list = LStore.getArr(Keys.MASTER_BLOK) || [];
  const b = list.find(x => String(x.id) === String(id));
  return b ? (b.nama || b.kode || b.id) : (id || '');
}
function _f2(n){ const v = Number(n); return Number.isFinite(v) ? v.toFixed(2) : ''; }

// ---- JSONP fallback mini ----
function _gasBase(){
  const base = ((typeof window!=='undefined' && window.GAS_BASE_URL) || localStorage.getItem('API_BASE') || '').replace(/\/$/,'');
  if (!base) throw new Error('JSONP base belum diset. Set window.GAS_BASE_URL atau localStorage "API_BASE".');
  if (/macros\/echo\b/.test(base)) console.error('URL GAS salah: gunakan /exec, bukan /macros/echo');
  return base;
}
function hasJSONPFallback(){ return !!((typeof window!=='undefined' && window.GAS_BASE_URL) || localStorage.getItem('API_BASE')); }
function gasJSONP(route, params={}){
  const base = _gasBase();
  return new Promise((resolve, reject)=>{
    const cb='__jsonp_cb_'+Math.random().toString(36).slice(2);
    const qs=new URLSearchParams({ ...params, route, callback:cb }).toString();
    const s=document.createElement('script'); let done=false;
    function cleanup(){ try{ delete window[cb]; }catch(_){} s.remove(); }
    window[cb]=(resp)=>{ done=true; resolve(resp); cleanup(); };
    s.onerror=()=>{ if(!done){ reject(new Error('JSONP error')); cleanup(); } };
    s.src=`${base}?${qs}`; document.body.appendChild(s);
    setTimeout(()=>{ if(!done){ reject(new Error('JSONP timeout')); cleanup(); } }, 20000);
  });
}

// ---- State UI ----
let SV_PAGE=1, SV_SIZE=20, SV_Q='', SV_SORT_BY='tanggal', SV_SORT_DIR='desc';
const SV_STATE_KEY='syncView.state.v1';
function _saveState(){
  try{
    const state={ page:SV_PAGE, size:SV_SIZE, q:SV_Q, sortBy:SV_SORT_BY, sortDir:SV_SORT_DIR, filter:($('#f-status')?.value||'all') };
    localStorage.setItem(SV_STATE_KEY, JSON.stringify(state));
  }catch(_){}
}
function _loadState(){
  try{
    const s=JSON.parse(localStorage.getItem(SV_STATE_KEY)||'{}');
    SV_PAGE=s.page||1; SV_SIZE=s.size||20; SV_Q=s.q||''; SV_SORT_BY=s.sortBy||'tanggal'; SV_SORT_DIR=s.sortDir||'desc';
    const f=$('#f-status'); if(f && s.filter) f.value=s.filter;
  }catch(_){}
}

let SV_BUSY=false;
function _setBusyUI(busy){
  SV_BUSY=!!busy;
  ['#btn-sync-all','#btn-sync-selected','#btn-export','#sv-search','#sv-size','#f-status'].forEach(sel=>{
    const el=$(sel); if (el) el.disabled=SV_BUSY;
  });
  document.querySelectorAll('#sync-table button, #sync-table input[type="checkbox"]').forEach(el=> el.disabled=SV_BUSY);
}

// ---- Data helpers ----
function statusIcon(st){ return st==='synced' ? '✅' : (st==='edited' ? '⭕' : '⬜'); }
function computeStats(){
  const rows = LStore.getArr(Keys.INPUT_RECORDS) || [];
  const total = rows.length;
  const pending = rows.filter(r=>r.sync_status==='pending').length;
  const edited  = rows.filter(r=>r.sync_status==='edited').length;
  const synced  = rows.filter(r=>r.sync_status==='synced').length;
  return { total, pending, edited, synced };
}
function _getSyncRows(filter='all'){
  let rows=(LStore.getArr(Keys.INPUT_RECORDS)||[]).slice();
  if (filter && filter!=='all') rows = rows.filter(r=> r.sync_status===filter);
  return rows.map(r=>({ ...r, _blokName:_blokNameById(r.blok_id) }));
}

// ---- View ----
function view(){
  return `
  <div class="card">
    <h2>Sinkronisasi</h2>
    <div class="card sync-status" id="sync-status"></div>
    <div class="row" style="margin-top:8px; gap:8px">
      <div class="col"><button class="primary" id="btn-sync-all">Sinkron Semua</button></div>
      <div class="col"><button id="btn-sync-selected">Sinkron Terpilih</button></div>
      <div class="col"><button id="btn-export">Export CSV (Filter)</button></div>
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
    #sync-pager .pager-bar{ display:flex; gap:6px; align-items:center; white-space:nowrap; }
    #sync-pager .pager-btn{ padding:4px 10px; border:1px solid var(--border); background:var(--table-cell-bg);
      border-radius:6px; cursor:pointer; line-height:1; font-size:12px; }
    #sync-pager .pager-btn.active{ background:var(--primary); color:#fff; border-color:var(--primary); }
    #sync-pager .pager-btn[disabled]{ opacity:.45; cursor:not-allowed; }
    #sync-pager .pager-ellipsis{ padding:0 4px; color:var(--muted); }
    #sync-table .num{ text-align:right; }
    #sync-table th.sortable{ cursor:pointer; user-select:none; }
    #sync-table th.sortable .dir{ opacity:.6; font-weight:700; margin-left:4px; }
  </style>
  `;
}

// ---- Table render + pager ----
let _lastPages=1;
function _renderPager(container, page, pages){
  const clamp=n=>Math.max(1,Math.min(pages,n));
  const btn=(label,target,{active=false,disabled=false}={})=>`<button class="pager-btn ${active?'active':''}" ${disabled?'disabled':''} data-go="${disabled?'':target}">${label}</button>`;
  const dots=`<span class="pager-ellipsis">…</span>`;
  const parts=[];
  parts.push(btn('‹', clamp(page-1), {disabled:page<=1}));
  if (pages<=7){
    for(let i=1;i<=pages;i++) parts.push(btn(String(i),i,{active:i===page}));
  }else{
    parts.push(btn('1',1,{active:page===1}));
    if (page>3) parts.push(dots);
    const start=Math.max(2,page-1), end=Math.min(pages-1,page+1);
    for (let i=start;i<=end;i++) parts.push(btn(String(i),i,{active:i===page}));
    if (page<pages-2) parts.push(dots);
    parts.push(btn(String(pages),pages,{active:page===pages}));
  }
  parts.push(btn('›', clamp(page+1), {disabled:page>=pages}));
  container.innerHTML = `<div class="pager-bar">${parts.join('')}</div>`;
  container.querySelectorAll('.pager-btn[data-go]').forEach(b=>{
    const target=Number(b.getAttribute('data-go')); if (!isNaN(target) && target>0){
      b.addEventListener('click', ()=>{ SV_PAGE=target; renderSyncTable(); _saveState(); });
    }
  });
}

function _exportCSV(){
  const filter = $('#f-status').value || 'all';
  const q = (SV_Q||'').trim().toLowerCase();
  let rows = _getSyncRows(filter);
  if (q){
    rows = rows.filter(r => (r.tanggal||'').toLowerCase().includes(q) ||
                            String(r.divisi_id||'').toLowerCase().includes(q) ||
                            String(r._blokName||'').toLowerCase().includes(q));
  }
  const header=['local_id','status','tanggal','divisi','blok','jjg','hk','tonase'];
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const lines=[ header.join(','), ...rows.map(r=>[r.local_id,r.sync_status,r.tanggal||'',r.divisi_id||'',r._blokName||'',_f2(r.jjg),_f2(r.hk),_f2(r.tonase_ton)].map(esc).join(',')) ];
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`sync-export-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

function renderSyncTable(){
  const filter = $('#f-status').value || 'all';
  const q = (SV_Q||'').trim().toLowerCase();
  let rows = _getSyncRows(filter);

  // search
  if (q){
    rows = rows.filter(r => (r.tanggal||'').toLowerCase().includes(q) ||
                            String(r.divisi_id||'').toLowerCase().includes(q) ||
                            String(r._blokName||'').toLowerCase().includes(q));
  }

  // sort
  rows.sort((a,b)=>{
    const A = (SV_SORT_BY==='tanggal') ? a.tanggal
            : (SV_SORT_BY==='divisi_id') ? String(a.divisi_id||'')
            : String(a._blokName||'');
    const B = (SV_SORT_BY==='tanggal') ? b.tanggal
            : (SV_SORT_BY==='divisi_id') ? String(b.divisi_id||'')
            : String(b._blokName||'');
    if (A===B) return 0; const cmp=(A>B)?1:-1; return SV_SORT_DIR==='asc'?cmp:-cmp;
  });

  // paging
  const total = rows.length;
  _lastPages = Math.max(1, Math.ceil(total / SV_SIZE));
  if (SV_PAGE > _lastPages) SV_PAGE = _lastPages;
  const start = (SV_PAGE-1)*SV_SIZE;
  const pageRows = rows.slice(start, start+SV_SIZE);

  // table
  $('#sync-table').innerHTML = `
  <table class="table">
    <thead>
      <tr>
        <th><input type="checkbox" id="ck-all"/></th>
        <th>Status</th>
        <th class="sortable" data-sort="tanggal">Tanggal <span class="dir">${SV_SORT_BY==='tanggal'?(SV_SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
        <th class="sortable" data-sort="divisi_id">Divisi <span class="dir">${SV_SORT_BY==='divisi_id'?(SV_SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
        <th class="sortable" data-sort="_blokName">Blok <span class="dir">${SV_SORT_BY==='_blokName'?(SV_SORT_DIR==='asc'?'▲':'▼'):''}</span></th>
        <th class="num">Luas (Ha)</th>
        <th class="num">JJG</th>
        <th class="num">Br (kg)</th>
        <th class="num">HK</th>
        <th class="num">Tonase</th>
      </tr>
    </thead>
    <tbody>
      ${pageRows.map(r=>`
        <tr>
          <td><input type="checkbox" class="ck-row" data-id="${r.local_id}"/></td>
          <td>${statusIcon(r.sync_status)}</td>
          <td>${r.tanggal||''}</td>
          <td>${r.divisi_id||''}</td>
          <td>${r._blokName||''}</td>
          <td class="num">${_f2(r.luas_panen_ha)}</td>
          <td class="num">${_f2(r.jjg)}</td>
          <td class="num">${_f2(r.brondolan_kg)}</td>
          <td class="num">${_f2(r.hk)}</td>
          <td class="num">${_f2(r.tonase_ton)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;

  // sort header
  document.querySelectorAll('#sync-table th.sortable').forEach(th=>{
    th.onclick=()=>{
      const k=th.getAttribute('data-sort');
      if (SV_SORT_BY===k) SV_SORT_DIR = (SV_SORT_DIR==='asc'?'desc':'asc');
      else { SV_SORT_BY=k; SV_SORT_DIR=(k==='tanggal'?'desc':'asc'); }
      renderSyncTable(); _saveState();
    };
  });

  // ck all
  $('#ck-all').addEventListener('change', (e)=>{
    document.querySelectorAll('.ck-row').forEach(ck=>{ ck.checked = e.target.checked; });
  });

  // pager
  _renderPager(document.getElementById('sync-pager'), SV_PAGE, _lastPages);
}

function renderHeaderStats(){
  const s = computeStats();
  $('#sync-status').innerHTML = `
    <div style="display:flex; gap:12px; flex-wrap:wrap">
      <span class="badge">Total: <b>${s.total}</b></span>
      <span class="badge">Pending: <b>${s.pending}</b></span>
      <span class="badge">Edited: <b>${s.edited}</b></span>
      <span class="badge">Synced: <b>${s.synced}</b></span>
    </div>`;
}

// ---- Sync logic ----
function _collectSelectedLocalIds(){
  return Array.from(document.querySelectorAll('.ck-row:checked')).map(x=> x.getAttribute('data-id'));
}
function _rowsByIds(ids){
  const set=new Set(ids); return (LStore.getArr(Keys.INPUT_RECORDS)||[]).filter(r=> set.has(r.local_id));
}
function _markSynced(localIds){
  if (!localIds.length) return;
  const set=new Set(localIds);
  const rows=(LStore.getArr(Keys.INPUT_RECORDS)||[]).map(r=>{
    if (set.has(r.local_id)) return { ...r, sync_status:'synced' };
    return r;
  });
  LStore.setArr(Keys.INPUT_RECORDS, rows);
  // bersihkan antrean
  const q = new Set(LStore.getArr(Keys.SYNC_QUEUE)||[]);
  localIds.forEach(id=> q.delete(id));
  LStore.setArr(Keys.SYNC_QUEUE, [...q]);
}

async function syncBulk(records){
  // coba bulk terlebih dahulu
  try{
    const res = await API.syncBulk({ records });
    if (res && res.ok) return { ok:true };
    throw new Error(res?.error || 'Sync bulk gagal');
  }catch(errBulk){
    // fallback per-record (check → insert/update) dengan JSONP bila perlu
    let ok=0, fail=0;
    for (const rec of records){
      try{
        const key = await (async ()=>{
          // serverKeyOf di core/sync.js = fnv1a(nik|tanggal|blok), kita ulang sederhana di sini
          const s = `${rec.nik_mandor||''}|${rec.tanggal||''}|${rec.blok_id||''}`;
          let h = 0x811c9dc5 >>> 0;
          for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + (h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)) >>> 0; }
          return ('0000000'+h.toString(16)).slice(-8);
        })();

        // check
        let exists = false;
        try{
          const ch = await API.checkKey({ key });
          if (!ch || !ch.ok) throw new Error(ch?.error || 'cek gagal');
          exists = !!(ch.data && ch.data.exists);
        }catch(_errCheck){
          if (!hasJSONPFallback()) throw _errCheck;
          const rj = await gasJSONP('pusingan.check', { key });
          if (!rj || !rj.ok) throw new Error(rj?.error || 'cek(JSONP) gagal');
          exists = !!(rj.data && rj.data.exists);
        }

        // insert/update
        if (exists){
          try{
            const up = await API.pushUpdate({ key, record: rec });
            if (!up || !up.ok) throw new Error(up?.error || 'update failed');
          }catch(_errUpd){
            if (!hasJSONPFallback()) throw _errUpd;
            const rj = await gasJSONP('pusingan.update', { key, payload: JSON.stringify(rec) });
            if (!rj || !rj.ok) throw new Error(rj?.error || 'update(JSONP) gagal');
          }
        }else{
          try{
            const ins = await API.pushInsert({ record: rec });
            if (!ins || !ins.ok) throw new Error(ins?.error || 'insert failed');
          }catch(_errIns){
            if (!hasJSONPFallback()) throw _errIns;
            const rj = await gasJSONP('pusingan.insert', { payload: JSON.stringify(rec) });
            if (!rj || !rj.ok) throw new Error(rj?.error || 'insert(JSONP) gagal');
          }
        }

        ok++;
      }catch(e){
        fail++;
      }
    }
    return (fail===0) ? { ok:true } : { ok:false, error:`Sebagian gagal (${fail})` };
  }
}

async function doSync(localIds){
  if (!localIds.length){ showToast('Pilih data terlebih dulu'); return; }
  const records = _rowsByIds(localIds);
  _setBusyUI(true);
  Progress.open({ title:'Sinkronisasi', subtitle:'Mengirim data…' });
  Progress.switchToDeterminate(records.length);

  let done=0;
  try{
    const res = await syncBulk(records);
    done = records.length;
    Progress.tick(done, records.length);
    if (!res || !res.ok) throw new Error(res?.error || 'Sync gagal');

    _markSynced(localIds);
    showToast(`Sinkron sukses: ${records.length} baris`);
  }catch(e){
    showToast(e.message || 'Gagal sinkron sebagian/semua');
  }finally{
    Progress.close();
    _setBusyUI(false);
    renderHeaderStats(); renderSyncTable();
  }
}

// ---- Mount ----
function bind(){
  _loadState(); renderHeaderStats(); renderSyncTable();

  $('#btn-export').addEventListener('click', _exportCSV);
  $('#f-status').addEventListener('change', ()=>{ SV_PAGE=1; renderHeaderStats(); renderSyncTable(); _saveState(); });
  $('#sv-search').addEventListener('input', (e)=>{ SV_Q=e.target.value||''; SV_PAGE=1; renderSyncTable(); _saveState(); });
  $('#sv-size').addEventListener('change', (e)=>{ SV_SIZE=+e.target.value||20; SV_PAGE=1; renderSyncTable(); _saveState(); });

  $('#btn-sync-all').addEventListener('click', ()=>{
    const filter = $('#f-status').value || 'all';
    const rows = _getSyncRows(filter);
    const ids  = rows.filter(r=> r.sync_status!=='synced').map(r=> r.local_id);
    doSync(ids);
  });
  $('#btn-sync-selected').addEventListener('click', ()=>{
    const ids = _collectSelectedLocalIds();
    doSync(ids);
  });
}

export function render(app){ app.innerHTML = view(); bind(); }
