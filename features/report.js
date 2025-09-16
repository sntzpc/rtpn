// =====================
// File: features/report.js
// =====================
import { $, fmtDateISO, ensureNumber } from '../core/utils.js';
import { Keys, LStore } from '../core/storage.js';

// === Paraf Digital harian (monitor footer) ===
const PARAF_DAY_KEY = (Keys.PARAF_DAY_LOG || 'pp2:paraf.daylog');

function pfAll(){ return LStore.getArr(PARAF_DAY_KEY) || []; }
function pfSave(arr){ LStore.setArr(PARAF_DAY_KEY, arr); }
function pfSig(){
  return {
    assistant_nik:  localStorage.getItem(Keys.NIK)  || localStorage.getItem('pp2:session.nik')  || '',
    assistant_name: localStorage.getItem(Keys.NAME) || localStorage.getItem('pp2:session.name') || '',
  };
}

// Cek sudah diparaf untuk 1 tanggal
function pfIsMarked({scope, key, dateISO}){
  return !!pfAll().find(x => x.scope===scope && String(x.key)===String(key) && x.date===dateISO);
}

// Toggle/set status paraf untuk 1 tanggal
function pfToggle({scope, key, dateISO, on}){
  const all = pfAll();
  const i = all.findIndex(x => x.scope===scope && String(x.key)===String(key) && x.date===dateISO);
  if (on){
    if (i<0) all.push({ scope, key, date: dateISO, ...pfSig(), ts: new Date().toISOString() });
  }else{
    if (i>=0) all.splice(i,1);
  }
  pfSave(all);
}

// Kumpulan tanggal (Set<ISO>) yang sudah diparaf untuk 1 bulan (scope+key)
function pfMarkedSetMonth({scope, key, y, m}){
  const ym = `${y}-${String(m).padStart(2,'0')}-`;
  const set = new Set();
  pfAll().forEach(x=>{
    if (x.scope===scope && String(x.key)===String(key) && String(x.date||'').startsWith(ym)) set.add(x.date);
  });
  return set;
}


// --- Helper nama blok (id -> nama/kode) ---
function _blokNameById(id){
  const list = LStore.getArr(Keys.MASTER_BLOK) || [];
  const b = list.find(x => String(x.id) === String(id));
  return b ? (b.nama || b.kode || b.id) : (id || '');
}

// --- Parser angka yg toleran koma desimal "12,5" ---
function _num(x){
  if (typeof x === 'string') x = x.replace(',', '.');
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// --- Ambil angka pertama yang valid (>0) dari beberapa kandidat field ---
function _firstNum(obj, keys){
  for (const k of keys){
    const v = _num(obj?.[k]);
    if (v > 0) return v;
  }
  return 0;
}

// --- BJR dari master blok (mencoba beberapa kemungkinan nama kolom) ---
function _bjrFromMaster(blok_id){
  const blk = (LStore.getArr(Keys.MASTER_BLOK) || [])
    .find(x => String(x.id) === String(blok_id));
  if (!blk) return 0;
  return _firstNum(blk, ['bjr','bjr_kg','bjrKg','rata_bjr','rataBjr','avg_bjr','bjr_kg_per_jjg']);
}

// --- BJR dari record (beberapa kemungkinan nama field) ---
function _bjrFromRecord(r){
  return _firstNum(r, ['bjr','bjr_kg','bjrKg','rata_bjr','rataBjr','bjr_kg_per_jjg']);
}

// --- Resolver BJR: record → master → infer dari tonase & jjg ---
function _resolveBJR(r){
  let bjr = _bjrFromRecord(r);
  if (!bjr) bjr = _bjrFromMaster(r.blok_id);
  if (!bjr){
    const ton = _num(r.tonase_ton);
    const jjg = _num(r.jjg);
    if (ton > 0 && jjg > 0) bjr = (ton * 1000) / jjg; // kg/jjg
  }
  return bjr;
}

// --- Brondolan kg: dukung beberapa nama field ---
function _brondolKg(r){
  return _firstNum(r, ['brondolan_kg','br_kg','brondolan','lf_kg']);
}

// --- angka 2 desimal ---
function _f2(n){ const v = Number(n); return Number.isFinite(v) ? v.toFixed(2) : ''; }

function monthDays(y, m){ return new Date(y, m, 0).getDate(); } // m=1..12
function pad2(n){ return n<10?'0'+n:String(n); }

function view(){
  return `
  <div class="card">
    <h2>Laporan</h2>
    <div class="row">
      <div class="col"><label>Bulan</label><select id="f-month">${Array.from({length:12},(_ ,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select></div>
      <div class="col"><label>Tahun</label><select id="f-year"></select></div>
      <div class="col"><label>Tampilan</label>
        <select id="f-view">
          <option value="ringkas">Ringkas</option>
          <option value="monitor">Monitoring</option>
        </select>
      </div>
      <div class="col"><label>Mode</label>
        <select id="f-mode">
          <option value="mandor">Per Mandor</option>
          <option value="divisi">Per Divisi</option>
        </select>
      </div>
      <div class="col" id="wrap-mandor"><label>Mandor</label><select id="f-mandor"></select></div>
      <div class="col" id="wrap-divisi" style="display:none"><label>Divisi</label><select id="f-divisi"></select></div>
      <div class="col"><button class="primary" id="btn-run">Tampilkan</button></div>
    </div>
  </div>

  <div id="wrap-paraf" class="card" style="display:none">
    <h3>Paraf Digital (Asisten)</h3>
    <button id="btn-paraf">Paraf</button>
  </div>

  <div id="report-out"></div>

  <style>
    .moni table { width:100%; border-collapse:collapse; }
    .moni th, .moni td { border:1px solid #ddd; padding:4px; text-align:center; font-size:12px; }
    .moni thead th { background:#f3f4f6; position:sticky; top:0; z-index:1;}
    .moni .kiri { text-align:left; }
    .moni .full { background:#1f8f36; color:#fff; font-weight:600; }
    .moni .part { background:#f7c77b; color:#111; font-weight:600; }
    .moni .wk   { background:#c026d3; color:#fff; }        /* 7/14/21/28 */
    .moni .off  { background:#e5e7eb; color:#111; }        /* libur */
    .moni .sub  { background:#fde68a; font-weight:600; }   /* baris total per kadvel */
    .moni .grand{ background:#fca5a5; font-weight:700; }   /* grand total */
    .moni .headL { white-space:nowrap; }
    /* angka rata kanan */
.table td.num, .table th.num { text-align: right; }
/* header tombol sorting */
.table th.sortable { cursor: pointer; user-select:none; }
.table th.sortable .dir { opacity:.6; font-weight:700; margin-left:4px; }
/* pager (ringkas) */
#rg-pager .pager-bar{ display:flex; gap:6px; align-items:center; white-space:nowrap; }
#rg-pager .pager-btn{
  padding:4px 10px; border:1px solid var(--border); background:var(--table-cell-bg);
  border-radius:6px; cursor:pointer; line-height:1; font-size:12px;
}
#rg-pager .pager-btn.active{ background:var(--primary); color:#fff; border-color:var(--primary); }
#rg-pager .pager-btn[disabled]{ opacity:.45; cursor:not-allowed; }
#rg-pager .pager-ellipsis{ padding:0 4px; color:var(--muted); }
/* === Ringkas: scroll horizontal hanya di tabel === */
#app{ overflow-x: hidden; overscroll-behavior-x: contain; } /* cegah halaman ikut geser */
#rg-table{ position: relative; }

#rg-table .h-scroll{
  overflow-x: auto;
  overflow-y: hidden;
  width: 100%;
  -webkit-overflow-scrolling: touch;  /* smooth di iOS */
  touch-action: pan-x;                /* geser kanan-kiri di dalam kontainer */
}

/* Paksa tabel lebih lebar dari layar agar memicu scroll */
#rg-table .h-scroll .table{
  min-width: 1000px;                  /* sesuaikan bila kolom banyak */
}

/* Di layar kecil, tambah lebar minimum */
@media (max-width: 480px){
  #rg-table .h-scroll .table{ min-width: 1100px; }
}

/* === Ringkas: cegah overflow halaman & izinkan scroll hanya di kontainer === */
#report-out.is-ringkas,
#report-out.is-ringkas .card{
  max-width:100%;
  overflow-x:hidden;                   /* kartu tidak melebarin halaman */
}

/* kontainer scroll untuk tabel ringkas */
#rg-table .h-scroll{
  overflow-x:auto;
  overflow-y:hidden;
  max-width:100%;
  -webkit-overflow-scrolling:touch;
  touch-action: pan-x;                 /* Android/Chrome */
  overscroll-behavior-inline:contain;  /* cegah “nyeret” halaman */
}

/* paksa tabel lebih lebar agar memicu scroll, tapi tetap di dalam kontainer */
#rg-table .h-scroll .table{
  display: inline-table;               /* hindari “meluber” layout flex */
  min-width: 1000px;
}

/* Filter & KPI biar tidak mendorong lebar layar di mobile */
@media (max-width: 768px){
  #report-out .card > .row{ flex-wrap: wrap; gap:8px; }     /* bar filter bisa patah baris */
  #report-out .card > .row .col{ flex:1 1 140px; min-width:140px; }
  #report-out .kpi{display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:8px;
}

/* (opsional) tambahkan baris ini kalau masih ada dorongan horizontal */
html, body, #app{ max-width:100%; overflow-x:hidden; }

  </style>
  `;
}

function yearOptions(){
  const years = new Set();
  (LStore.getArr(Keys.INPUT_RECORDS)||[]).forEach(r=>{
    const y = (r.tanggal||'').slice(0,4);
    if (y) years.add(y);
  });
  const arr = [...years].sort();
  const now = new Date().getFullYear();
  if (!arr.includes(String(now))) arr.push(String(now));
  return arr.map(y=>`<option value="${y}">${y}</option>`).join('');
}

function fillSelectors(){
  $('#f-year').innerHTML = yearOptions();

  // mandor
  const mandor = (LStore.getArr(Keys.MASTER_MANDOR)||[]);
  $('#f-mandor').innerHTML = mandor.map(m=>`<option value="${m.nik}">${m.nama||m.nik} (${m.nik})</option>`).join('');

  // divisi
  const divisi = (LStore.getArr(Keys.MASTER_DIVISI)||[]);
  $('#f-divisi').innerHTML = divisi.map(d=>`<option value="${d.id}">${d.nama||d.kode||d.id}</option>`).join('');
}

function holidaysSet(y, m){
  const list = (LStore.getArr(Keys.MASTER_LIBUR)||[]);
  const set = new Set();
  const ym = `${y}-${pad2(m)}-`;
  list.forEach(x=>{
    const t = String(x.tanggal||'');
    if (t.startsWith(ym)){
      const d = Number(t.slice(8,10));
      if (d>=1) set.add(d);
    }
  });
  return set; // Set of day numbers in this month
}

// --- himpunan hari Minggu (dinamis per bulan) ---
function sundaysSet(y, m){
  const set = new Set();
  const n = monthDays(y, m); // m = 1..12
  for (let d = 1; d <= n; d++){
    if (new Date(y, m-1, d).getDay() === 0) set.add(d); // 0 = Sunday
  }
  return set; // Set<number> berisi tgl yang Minggu
}


// ===== RINGKAS (lama) =====
function filterData(m, y, mode, key){
  const recs = (LStore.getArr(Keys.INPUT_RECORDS)||[]).filter(r=>{
    if (!r.tanggal) return false;
    const ym = r.tanggal.slice(0,7);
    if (ym !== `${y}-${pad2(m)}`) return false;
    if (mode==='mandor') return String(r.nik_mandor)===String(key);
    if (mode==='divisi') return String(r.divisi_id)===String(key);
    return true;
  });
  return recs;
}

function summarize(rows){
  let sumTon = 0, sumHK = 0, sumLuas = 0;
  let sumBr  = 0, sumDenom = 0; // untuk %LF

  rows.forEach(r=>{
    const ton = _num(r.tonase_ton);
    const hk  = _num(r.hk);
    const ls  = _num(r.luas_panen_ha);
    sumTon  += ton; sumHK += hk; sumLuas += ls;

    const jjg = _num(r.jjg);
    const bjr = _resolveBJR(r);
    const br  = _brondolKg(r);
    sumBr    += br;
    sumDenom += (jjg * bjr);     // kg
  });

  const thk = sumHK>0 ? (sumTon/sumHK) : 0;
  const tha = sumLuas>0 ? (sumTon/sumLuas) : 0;
  const lf  = sumDenom>0 ? (sumBr / sumDenom) * 100 : 0;

  return {
    ton:+sumTon.toFixed(2),
    hk:+sumHK.toFixed(2),
    luas:+sumLuas.toFixed(2),
    tonPerHK:+thk.toFixed(2),
    tonPerHa:+tha.toFixed(2),
    lfPctAvg:+lf.toFixed(2)
  };
}



// ========== RINGKAS: Tabel dengan search + sort + paging ==========
function renderRingkas(){
  const m = Number($('#f-month').value);
  const y = Number($('#f-year').value);
  const mode = $('#f-mode').value;
  const key = (mode==='mandor') ? $('#f-mandor').value : $('#f-divisi').value;

  // data mentah
const baseRows = filterData(m, y, mode, key).map(r => {
  const jjg = _num(r.jjg);
  const bjr = _resolveBJR(r);
  const br  = _brondolKg(r);
  const denomKg = jjg * bjr;
  const lfPct = denomKg>0 ? (br/denomKg)*100 : 0;

  return {
    ...r,
    _blokName: _blokNameById(r.blok_id),
    _tonPerHK: _num(r.hk) > 0 ? (_num(r.tonase_ton)/_num(r.hk)) : 0,
    _tonPerHa: _num(r.luas_panen_ha) > 0 ? (_num(r.tonase_ton)/_num(r.luas_panen_ha)) : 0,
    _lfPct: lfPct
  };
});

  // state UI
  let page = 1;
  let pageSize = 20;                     // default
  let q = '';                            // search
  let sortBy = 'tanggal';                // tanggal|divisi_id|_blokName
  let sortDir = 'desc';                  // asc|desc

  // rangka KPI
  const sum = summarize(baseRows);
  const out = $('#report-out');
  out.classList.add('is-ringkas');
  out.innerHTML = `
    <div class="kpi">
      <div class="card"><b>Total Tonase</b><div class="badge">${sum.ton.toFixed(2)} ton</div></div>
      <div class="card"><b>%LF</b><div class="badge">${sum.lfPctAvg.toFixed(2)} %</div></div>
      <div class="card"><b>Total HK</b><div class="badge">${sum.hk.toFixed(2)}</div></div>
      <div class="card"><b>Total Luas</b><div class="badge">${sum.luas.toFixed(2)} ha</div></div>
      <div class="card"><b>Ton/HK</b><div class="badge">${sum.tonPerHK.toFixed(2)}</div></div>
      <div class="card"><b>Ton/Ha</b><div class="badge">${sum.tonPerHa.toFixed(2)}</div></div>
    </div>

    <div class="row" style="align-items:flex-end; gap:8px; margin:.5rem 0">
      <div class="col">
        <label>Cari</label>
        <input id="rg-search" placeholder="Tanggal / Divisi / Blok"/>
      </div>
      <div class="col">
        <label>Tampil</label>
        <select id="rg-size">
          <option value="20" selected>20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="1000">1000</option>
        </select>
      </div>
    </div>

    <div id="rg-table"></div>
    <div id="rg-pager" style="margin-top:8px;"></div>
  `;

  const elTable = $('#rg-table');
  const elPager = $('#rg-pager');

  function apply(){
    // filter by search
    const qq = q.trim().toLowerCase();
    let rows = !qq ? baseRows : baseRows.filter(r=>{
      return (r.tanggal||'').toLowerCase().includes(qq) ||
             (String(r.divisi_id||'').toLowerCase().includes(qq)) ||
             (String(r._blokName||'').toLowerCase().includes(qq));
    });

    // sorting
    rows.sort((a,b)=>{
      const A = (sortBy==='tanggal') ? a.tanggal
              : (sortBy==='divisi_id') ? String(a.divisi_id || '')
              : String(a._blokName || '');
      const B = (sortBy==='tanggal') ? b.tanggal
              : (sortBy==='divisi_id') ? String(b.divisi_id || '')
              : String(b._blokName || '');
      if (A===B) return 0;
      const cmp = (A>B) ? 1 : -1;
      return sortDir==='asc' ? cmp : -cmp;
    });

    // paging
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) page = pages;
    const start = (page-1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    // table HTML
    elTable.innerHTML = `
        <div class="h-scroll">
    <table class="table">
      <thead>
        <tr>
          <th class="sortable" data-sort="tanggal">Tanggal <span class="dir">${sortBy==='tanggal'?(sortDir==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="divisi_id">Divisi <span class="dir">${sortBy==='divisi_id'?(sortDir==='asc'?'▲':'▼'):''}</span></th>
          <th class="sortable" data-sort="_blokName">Blok <span class="dir">${sortBy==='_blokName'?(sortDir==='asc'?'▲':'▼'):''}</span></th>
          <th class="num">Luas (Ha)</th>
          <th class="num">JJG</th>
          <th class="num">Br (kg)</th>
          <th class="num">HK</th>
          <th class="num">Tonase</th>
          <th class="num">%LF</th>
          <th class="num">Ton/HK</th>
          <th class="num">Ton/Ha</th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map(r=>`
          <tr>
            <td>${r.tanggal}</td>
            <td>${r.divisi_id||''}</td>
            <td>${r._blokName||''}</td>
            <td class="num">${_f2(r.luas_panen_ha)}</td>
            <td class="num">${_f2(r.jjg)}</td>
            <td class="num">${_f2(r.brondolan_kg)}</td>
            <td class="num">${_f2(r.hk)}</td>
            <td class="num">${_f2(r.tonase_ton)}</td>
            <td class="num">${_f2(r._lfPct)}</td>
            <td class="num">${_f2(r._tonPerHK)}</td>
            <td class="num">${_f2(r._tonPerHa)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>
    `;

    // header click → sort
    elTable.querySelectorAll('th.sortable').forEach(th=>{
      th.onclick = ()=>{
        const k = th.getAttribute('data-sort');
        if (sortBy === k) sortDir = (sortDir==='asc' ? 'desc' : 'asc');
        else { sortBy = k; sortDir = (k==='tanggal' ? 'desc' : 'asc'); }
        apply();
      };
    });

// pager (ellipsis rapi)
renderPagerHorizontal(elPager, page, pages, (goto)=>{
  page = goto;
  apply();
});
  }

  // pager helper
function renderPagerHorizontal(container, p, pages, onChange){
  const clamp = (n)=> Math.max(1, Math.min(pages, n));
  const btn = (label, target, {active=false, disabled=false}={}) =>
    `<button class="pager-btn ${active?'active':''}" ${disabled?'disabled':''} data-go="${disabled?'':target}">${label}</button>`;
  const dots = `<span class="pager-ellipsis">…</span>`;

  const parts = [];
  // prev
  parts.push(btn('‹', clamp(p-1), {disabled: p<=1}));

  if (pages <= 7){
    for (let i=1;i<=pages;i++) parts.push(btn(String(i), i, {active: i===p}));
  }else{
    // 1 … (p-1, p, p+1) … last
    parts.push(btn('1', 1, {active: p===1}));
    if (p > 3) parts.push(dots);

    const start = Math.max(2, p-1);
    const end   = Math.min(pages-1, p+1);
    for (let i=start; i<=end; i++) parts.push(btn(String(i), i, {active: i===p}));

    if (p < pages-2) parts.push(dots);
    parts.push(btn(String(pages), pages, {active: p===pages}));
  }

  // next
  parts.push(btn('›', clamp(p+1), {disabled: p>=pages}));

  container.innerHTML = `<div class="pager-bar">${parts.join('')}</div>`;
  container.querySelectorAll('.pager-btn[data-go]').forEach(b=>{
    const target = Number(b.getAttribute('data-go'));
    if (!isNaN(target) && target>0){
      b.addEventListener('click', ()=> onChange(target));
    }
  });
}

  // initial events
  $('#rg-search').oninput = (e)=>{ q = e.target.value||''; page=1; apply(); };
  $('#rg-size').onchange = (e)=>{ pageSize = +e.target.value||20; page=1; apply(); };

  // default apply
  apply();
}


// --- helper pembulatan (kalau sudah ada, boleh hapus yang ini) ---
function f2(n){ const v = Number(n); return Number.isFinite(v) ? v.toFixed(2) : ''; }
function f1(n){ const v = Number(n); return Number.isFinite(v) ? v.toFixed(1) : ''; }

// --- helper tanggal untuk hitung beda hari & ISO tanpa zona waktu ---
function dObj(y,m,d){ return new Date(y, m-1, d); } // m:1..12
function isoOf(dt){ const y=dt.getFullYear(), m=pad2(dt.getMonth()+1), d=pad2(dt.getDate()); return `${y}-${m}-${d}`; }
function daysBetween(a,b){ return Math.round((a - b) / 86400000); } // a,b Date

// ===== MONITORING (carry-over lintas bulan + warna streak) =====
function monitorHTML(m, y, mode, key){
  const nDays = monthDays(y, m);
  const holidays = holidaysSet(y, m);
  const sundays  = sundaysSet(y, m);

  // data bulan terpilih (untuk tonase/luas & lastPanenGlobal)
  const rowsMonth = filterData(m, y, mode, key);

  // Map: blok_id -> { day -> luas } untuk bulan INI
  const byBlokDay = {};
  rowsMonth.forEach(r=>{
    const d = Number(String(r.tanggal).slice(8,10));
    (byBlokDay[r.blok_id] ||= {})[d] = (byBlokDay[r.blok_id][d]||0) + ensureNumber(r.luas_panen_ha,0);
  });

  // batas berhenti angka pusingan (setelah panen terakhir di bulan ini)
  const lastPanenGlobal = rowsMonth.reduce((mx,r)=>{
    const d = Number(String(r.tanggal).slice(8,10));
    return Number.isFinite(d) ? Math.max(mx,d) : mx;
  }, 0);

  // --- SET panen lintas-bulan dari semua input lokal (untuk carry-over) ---
  const allInputs = LStore.getArr(Keys.INPUT_RECORDS)||[];
  const panenSetMap = new Map(); // blok_id -> Set('YYYY-MM-DD')
  for (const r of allInputs){
    const luas = ensureNumber(r.luas_panen_ha,0);
    if (luas > 0){
      const id = r.blok_id;
      const t  = String(r.tanggal).slice(0,10); // pastikan ISO 'YYYY-MM-DD'
      if (!panenSetMap.has(id)) panenSetMap.set(id, new Set());
      panenSetMap.get(id).add(t);
    }
  }

  // helpers
  const kadvelList = LStore.getArr(Keys.MASTER_KADVEL)||[];
  const blokList   = LStore.getArr(Keys.MASTER_BLOK)||[];
  const kadvelName = (id)=>{ const k = kadvelList.find(x=>String(x.id)===String(id)); return k ? (k.nama||k.id) : (id||'-'); };
  const firstISO = `${y}-${pad2(m)}-01`;
  const parseISO = (s)=> dObj(+s.slice(0,4), +s.slice(5,7), +s.slice(8,10));

  // scope blok sesuai mode
  const visibleBlok = blokList.filter(b=>{
    if (mode==='mandor') return String(b.mandor_nik)===String(key);
    if (mode==='divisi') return String(b.divisi_id)===String(key);
    return true;
  });

    // header tanggal (tampilkan 1..nDays; beri kelas 'wk' utk Minggu dan 'off' utk libur)
  const daysHeader = Array.from({ length: nDays }, (_, i) => {
    const d = i + 1;
    const cls =
      (sundays.has(d) ? 'wk' : '') + (holidays.has(d) ? ' off' : '');
    return `<th class="day ${cls.trim()}">${d}</th>`;
  }).join('');


  // grand
  const grandPerDay = Array(nDays).fill(0);
  let grandTotal = 0, grandLuas = 0;

  // group by kadvel
  const group = {};
  visibleBlok.forEach(b=> (group[b.kadvel_id||'NA'] ||= []).push(b));

  const sectionRows = Object.keys(group).sort().map(kid=>{
    const rowsHTML = group[kid].sort((a,b)=>{
      const A=(a.kode||a.nama||a.id||'')+'';
      const B=(b.kode||b.nama||b.id||'')+'';
      return A.localeCompare(B);
    }).map(b=>{
      const name = b.nama || b.kode || b.id;
      const luas = ensureNumber(b.luas_ha,0);

      // ----- CARRY-OVER: tentukan runBase (hari "0" terakhir run sebelum bulan ini) -----
      const pset = panenSetMap.get(b.id) || new Set();

      // cari tanggal panen TERAKHIR sebelum tanggal 1 bulan ini
      let lastPrevISO = null;
      pset.forEach(t=>{
        if (t < firstISO && (!lastPrevISO || t > lastPrevISO)) lastPrevISO = t;
      });

      // default runBase = tanggal 0 (hari terakhir bulan lalu): ini bikin 1 di tgl 1 jika benar2 tanpa sejarah
      let runBase = dObj(y, m, 0);

      if (lastPrevISO){
        // tarik mundur ke awal rangkaian panen yang mencakup lastPrevISO
        let cur = parseISO(lastPrevISO);
        while (true){
          const prev = dObj(cur.getFullYear(), cur.getMonth()+1, cur.getDate()-1);
          if (pset.has(isoOf(prev))){ cur = prev; continue; }
          break;
        }
        runBase = cur; // hari panen pertama (=0) dari run sebelumnya
      }

      // panjang streak panen pada "hari 0" (untuk lintas bulan)
      const day0 = dObj(y, m, 0);
      const day0ISO = isoOf(day0);
      let panenStreakLen = 0;
      if (pset.has(day0ISO)){
        // hitung berapa hari berturut-turut sampai day0
        let cur = new Date(day0.getTime());
        while (pset.has(isoOf(cur))){
          panenStreakLen++;
          cur.setDate(cur.getDate()-1);
        }
      }

      // akumulator baris
      let tot = 0;

      const tds = Array.from({length:nDays}, (_,i)=>{
        const d = i+1;

        // stop di hari > lastPanenGlobal
        if (lastPanenGlobal && d > lastPanenGlobal){
          const clsTail = (sundays.has(d)?' wk':'') + (holidays.has(d)?' off':'');
          return `<td class="${clsTail.trim()}"></td>`;
        }

        const val = +(byBlokDay[b.id]?.[d]||0);
        let cls = '';

        if (val > 0){
          // PANEN: hitung streak lintas bulan
          const prevWasPanen = (i===0) ? pset.has(day0ISO) : (+(byBlokDay[b.id]?.[d-1]||0) > 0);
          panenStreakLen = prevWasPanen ? (panenStreakLen+1) : 1;

          // awal run baru → reset basis pusingan ke hari ini (0)
          if (!prevWasPanen) runBase = dObj(y, m, d);

          // warna: 1=full (hijau), 2=part (kuning), 3+=over (merah)
          if (panenStreakLen === 1) cls += ' full';
          else if (panenStreakLen === 2) cls += ' part';
          else cls += ' over';

          // jangan beri wk/off ke sel panen agar warna tidak ketimpa
          grandPerDay[d-1] += val; tot += val;
          return `<td class="${cls.trim()}"><span class="val">${f2(val)}</span></td>`;
        }else{
          // KOSONG: tampilkan angka pusingan; wk/off hanya untuk sel kosong
          if (sundays.has(d)) cls+=' wk';
          if (holidays.has(d)) cls+=' off';

          const rot = daysBetween(dObj(y,m,d), runBase); // 1,2,3,… menerus dari bulan lalu
          return `<td class="${cls.trim()}"><span class="rot-num">${rot}</span></td>`;
        }
      }).join('');

      grandTotal += tot; grandLuas += luas;
      const rotVal = (luas>0) ? (tot/luas) : 0;

return `<tr>
  <td class="kiri freeze1 w-kadvel">${kadvelName(kid)}</td>
  <td class="kiri headL freeze2 w-blok">${name}</td>
  <td class="freeze3 w-luas">${f2(luas)}</td>
  ${tds}
  <td>${f2(tot)}</td>
  <td>${f1(rotVal)}</td>
</tr>`;
    }).join('');

    // subtotal per kadvel
    const subPerDay = Array(nDays).fill(0);
    let subLuas = 0;
    group[kid].forEach(b=>{
      subLuas += ensureNumber(b.luas_ha,0);
      for (let d=1; d<=nDays; d++){
        subPerDay[d-1] += +(byBlokDay[b.id]?.[d]||0);
      }
    });
    const subTot = subPerDay.reduce((a,b)=>a+b,0);
    const subRot = subLuas>0 ? (subTot/subLuas) : 0;

const subRow = `<tr class="sub">
  <td class="kiri freeze1 w-kadvel2" colspan="2"><b>TOTAL ${kadvelName(kid)}</b></td>
  <td class="freeze3 w-luas"><b>${f2(subLuas)}</b></td>
  ${subPerDay.map((v,i)=>`<td class="${(sundays.has(i+1)?'wk':'')} ${holidays.has(i+1)?'off':''}">${v?f2(v):''}</td>`).join('')}
  <td><b>${f2(subTot)}</b></td>
  <td><b>${f1(subRot)}</b></td>
</tr>`;

    return rowsHTML + subRow;
  }).join('');

  const grandRot = grandLuas>0 ? (grandTotal/grandLuas) : 0;

const grandRow = `<tr class="grand">
  <td class="kiri freeze1 w-kadvel2" colspan="2"><b>GRAND TOTAL</b></td>
  <td class="freeze3 w-luas"><b>${f2(grandLuas)}</b></td>
  ${grandPerDay.map((v,i)=>`<td class="${(sundays.has(i+1)?'wk':'')} ${holidays.has(i+1)?'off':''}"><b>${v?f2(v):''}</b></td>`).join('')}
  <td><b>${f2(grandTotal)}</b></td>
  <td><b>${f1(grandRot)}</b></td>
</tr>`;

// === Baris paraf (footer) ===
const scope = (mode==='mandor' ? 'mandoran' : 'divisi');
const marked = pfMarkedSetMonth({ scope, key, y, m });

const parafCells = Array.from({length:nDays}, (_,i)=>{
  const d   = i+1;
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  const hasPanen = (grandPerDay[d-1] > 0); // aktif hanya jika ada panen pada hari tsb
  const isOn = marked.has(iso);
  const cls = `${(sundays.has(d)?'wk':'')} ${(holidays.has(d)?'off':'')} paraf-cell ${isOn?'pf-on':''}`;

  if (hasPanen){
    return `<td class="${cls.trim()}">
      <button type="button" class="pf-btn" data-iso="${iso}" aria-pressed="${isOn?'true':'false'}">${isOn?'✓':'○'}</button>
    </td>`;
  }else{
    return `<td class="${cls.trim()}"><span class="muted">—</span></td>`;
  }
}).join('');

// Kolom TOTAL & ROT di ujung → biarkan kosong
const parafRow = `<tr class="paraf-row">
  <td class="kiri freeze1 w-kadvel2" colspan="2"><b>Paraf (Asisten)</b></td>
  <td class="freeze3 w-luas"></td>
  ${parafCells}
  <td></td><td></td>
</tr>`;


return `
  <div class="card moni">
    <h3>Monitoring Pusingan Panen — Periode ${pad2(m)}/${y}</h3>

    <div class="grid-wrap">
      <table class="moni-grid">
        <thead>
          <tr>
            <th class="kiri freeze1 w-kadvel">Kadvel</th>
            <th class="kiri freeze2 w-blok">Blok</th>
            <th class="freeze3 w-luas">Luas</th>
            ${daysHeader}
            <th>TOTAL</th>
            <th>ROT</th>
          </tr>
        </thead>
        <tbody>
          ${sectionRows}
          ${grandRow}
          ${parafRow}
        </tbody>
      </table>
    </div>
  </div>`;
}


function renderMonitor(){
  const m    = Number($('#f-month').value);
  const y    = Number($('#f-year').value);
  const mode = $('#f-mode').value;
  const key  = (mode === 'mandor') ? $('#f-mandor').value : $('#f-divisi').value;

  const container = $('#report-out');         // <- ELEMEN-nya
  if (!container) return;
  container.classList.remove('is-ringkas');

  container.innerHTML = monitorHTML(m, y, mode, key);   // render tabelnya dulu

// === Toggle paraf di footer (hanya untuk role asisten) ===
const roleUser = localStorage.getItem('pp2:session.role') || localStorage.getItem(Keys.ROLE) || '-';
const scope = (mode==='mandor' ? 'mandoran' : 'divisi');

const btns = container.querySelectorAll('.paraf-row .pf-btn[data-iso]');
if (roleUser === 'asisten'){
  btns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const iso = btn.getAttribute('data-iso');
      const nextOn = btn.getAttribute('aria-pressed')!=='true';
      pfToggle({ scope, key, dateISO: iso, on: nextOn });
      btn.setAttribute('aria-pressed', nextOn?'true':'false');
      btn.textContent = nextOn ? '✓' : '○';
      btn.closest('td')?.classList.toggle('pf-on', nextOn);
    });
  });
}else{
  btns.forEach(b=> b.setAttribute('disabled', 'disabled'));
}


  // Sisipkan tombol "Cetak PDF (A4)" setelah tabel terpasang
  if (typeof enableReportPrint === 'function'){
    try {
      enableReportPrint({ container, m, y, mode, key });
    } catch (e) {
      console.error('enableReportPrint error:', e);
    }
  }
}


// ===== Bind & Render =====
function bind(){
  fillSelectors();
  const role = localStorage.getItem('pp2:session.role') || localStorage.getItem(Keys.ROLE) || '-';
  if (role==='asisten'){ $('#wrap-paraf').style.display='block'; }

  // Toggling mandor/divisi selector
  $('#f-mode').addEventListener('change', ()=>{
    const v = $('#f-mode').value;
    $('#wrap-mandor').style.display = (v==='mandor')?'block':'none';
    $('#wrap-divisi').style.display = (v==='divisi')?'block':'none';
  });

  $('#btn-run').addEventListener('click', ()=>{
    const v = $('#f-view').value;
    if (v==='monitor') renderMonitor();
    else renderRingkas();
  });

  // Paraf (asisten)
  $('#btn-paraf').addEventListener('click', ()=>{
    const v = $('#f-mode').value; const key = v==='mandor'? $('#f-mandor').value : $('#f-divisi').value;
    if (!key) return showToast('Pilih mandor/divisi dulu');
    const logs = LStore.getArr(Keys.PARAF_LOG||'pp2:paraf.log') || [];
    logs.push({ scope: v==='mandor'?'mandoran':'divisi', key, date: fmtDateISO(), assistant_nik: localStorage.getItem(Keys.NIK)||'', assistant_name: localStorage.getItem(Keys.NAME)||'', ts: new Date().toISOString() });
    LStore.setArr(Keys.PARAF_LOG||'pp2:paraf.log', logs);
    showToast('Paraf tersimpan');
  });
}

export function render(app){ app.innerHTML = view(); bind(); }

// ================================
// CETAK PDF: A4 Landscape + Header
// ================================
// -- helper label periode --
function _periodLabel(m,y){
  const MONTH = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${MONTH[(m-1)%12]} ${y}`;
}
// -- helper render info header (ambil dari master + filter yang dipakai) --
function _buildHeaderInfo({m,y,mode,key}){
  const company = (LStore.getArr(Keys.MASTER_COMPANY)||[])[0]?.nama || '';
  const estates = LStore.getArr(Keys.MASTER_ESTATE)||[];
  const divisi  = LStore.getArr(Keys.MASTER_DIVISI)||[];
  const kadvel  = LStore.getArr(Keys.MASTER_KADVEL)||[];
  const mandor  = LStore.getArr(Keys.MASTER_MANDOR)||[];

  let estateName='', divisiName='', kadvelName='', mandorName='';
  if (mode==='divisi'){
    const d = divisi.find(x=>String(x.id)===String(key));
    divisiName = d?.nama || d?.id || key || '';
    const e = estates.find(e=>String(e.id)===String(d?.estate_id));
    estateName = e?.nama || '';
  } else if (mode==='mandor'){
    const mdr = mandor.find(x=>String(x.nik)===String(key));
    mandorName = mdr?.nama || key || '';
    const divIds = new Set((LStore.getArr(Keys.MASTER_BLOK)||[])
      .filter(b=>String(b.mandor_nik)===String(key)).map(b=>String(b.divisi_id)));
    if (divIds.size===1){
      const d = divisi.find(x=>String(x.id)===Array.from(divIds)[0]);
      divisiName = d?.nama || d?.id || '';
      const e = estates.find(e=>String(e.id)===String(d?.estate_id)); estateName = e?.nama||'';
    }
  } else {
    // all/estate-level: kosongkan, atau ambil 1st estate bila tunggal
    if (estates.length===1) estateName = estates[0]?.nama || '';
  }

  return {
    company, estateName, divisiName, kadvelName, mandorName,
    title: 'Monitoring Pusingan Panen',
    periode: _periodLabel(m,y),
    printedAt: new Date().toLocaleString('id-ID', { hour12:false })
  };
}

// -- gaya print (inject sekali saja) --
function _ensurePrintStyleInjected(){
  if (document.getElementById('print-style-a4-landscape')) return;
  const css = `
@page { size: A4 landscape; margin: 10mm 10mm 12mm 10mm; }
@media print {
  /* minta browser cetak warna latar */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  body { background:#fff !important; }
  .no-print { display:none !important; }
}

.print-sheet {
  font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,'Noto Sans',sans-serif;
  color:#111;
}

/* header */
.print-header { display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center; margin-bottom:8px; }
.print-title { font-size:18px; font-weight:700; margin:0; }
.print-meta  { font-size:12px; line-height:1.4; }
.print-meta b{ font-weight:700; }

/* legenda: gunakan kotak teks berwarna (selalu tercetak) */
.print-legend { display:flex; gap:16px; align-items:center; margin:8px 0 6px; font-size:12px; }
.print-legend .sw { font-weight:900; font-size:13px; margin-right:6px; }
.print-legend .sw.full { color:#1f8f36; }
.print-legend .sw.part { color:#f59e0b; }  /* kuning-ish */
.print-legend .sw.over { color:#ef4444; }

/* header/footer tabel pada setiap halaman */
.print-sheet table { width:100%; border-collapse:collapse; }
.print-sheet thead { display: table-header-group; }
.print-sheet tfoot { display: table-footer-group; }

/* grid */
.print-sheet .moni th, .print-sheet .moni td {
  border:1px solid #d1d5db; padding:4px; text-align:center; font-size:11px; background:#fff; color:#111;
}
.print-sheet .moni thead th { background:#f3f4f6; color:#111; position: static !important; }
.print-sheet .moni .kiri { text-align:left; white-space:nowrap; }

/* warna sel panen (akan terpakai bila browser mengizinkan background printing) */
.print-sheet .moni .full{ background:#1f8f36 !important; color:#fff !important; font-weight:600; }
.print-sheet .moni .part{ background:#f7c77b !important; color:#111 !important; font-weight:600; }
.print-sheet .moni .over{ background:#ef4444 !important; color:#fff !important; font-weight:700; }

/* hari 7 & libur untuk sel kosong */
.print-sheet .moni .wk:not(.full):not(.part):not(.over){ background:#f5e1fa !important; color:#4b5563 !important; }
.print-sheet .moni .off:not(.full):not(.part):not(.over){ background:#eef2f7 !important; color:#374151 !important; }

/* angka pusingan */
.print-sheet .moni td .rot-num{ color:#6b7280; font-weight:600; }

/* hindari putus baris */
.print-sheet .moni tr { break-inside: avoid; page-break-inside: avoid; }

/* footer */
.print-footer { margin-top:6px; font-size:11px; color:#6b7280; display:flex; justify-content:space-between; }

/* ===== Fallback warna kalau background diblokir =====
   Tambah ikon kotak berwarna di depan angka panen.
*/
@media print {
  .print-sheet .moni td .val { position: relative; padding-left: 0; }
  .print-sheet .moni td.full  .val::before,
  .print-sheet .moni td.part  .val::before,
  .print-sheet .moni td.over  .val::before{
    font-weight:900;
  }
  .print-sheet .moni td.full  .val::before{ color:#1f8f36; }
  .print-sheet .moni td.part  .val::before{ color:#f59e0b; }
  .print-sheet .moni td.over  .val::before{ color:#ef4444; }
}
`;
  const s = document.createElement('style');
  s.id = 'print-style-a4-landscape';
  s.textContent = css;
  document.head.appendChild(s);
}


// -- bangun dokumen print --
function _buildPrintHTML({rootEl, headerInfo}){
  const table = rootEl.querySelector('table');
  const clonedTable = table.cloneNode(true);

  // hapus sticky behavior yang mungkin tertinggal (safety)
  clonedTable.querySelectorAll('th').forEach(th=> th.style.position = 'static');

const legendHTML = `
  <div class="print-legend">
    <span><i class="sw full">■</i>Hijau = Hari Ke-1</span>
    <span><i class="sw part">■</i>Kuning = Hari ke-2</span>
    <span><i class="sw over">■</i>Merah = Hari ke-3 dst..</span>
  </div>`;

  const metaLeft = [
    headerInfo.company ? `<div><b>Perusahaan:</b> ${headerInfo.company}</div>` : '',
    headerInfo.estateName ? `<div><b>Estate:</b> ${headerInfo.estateName}</div>` : '',
    headerInfo.divisiName ? `<div><b>Divisi:</b> ${headerInfo.divisiName}</div>` : '',
    headerInfo.kadvelName ? `<div><b>Kadvel:</b> ${headerInfo.kadvelName}</div>` : '',
    headerInfo.mandorName ? `<div><b>Mandor:</b> ${headerInfo.mandorName}</div>` : '',
    `<div><b>Periode:</b> ${headerInfo.periode}</div>`
  ].filter(Boolean).join('');

  const hdrHTML = `
    <div class="print-header">
      <div>
        <h1 class="print-title">${headerInfo.title}</h1>
        <div class="print-meta">${metaLeft}</div>
      </div>
      <div class="print-meta" style="text-align:right">
        <div><b>Tercetak:</b> ${headerInfo.printedAt}</div>
      </div>
    </div>`;

  const footerHTML = `
    <div class="print-footer">
      <div>Dokumen ini dicetak dari sistem Monitoring Pusingan Panen</div>
      <div>Periode: ${headerInfo.periode}</div>
    </div>`;

  return `
  <div class="print-sheet">
    ${hdrHTML}
    ${legendHTML}
    <div class="moni">${clonedTable.outerHTML}</div>
    ${footerHTML}
  </div>`;
}

// -- cetak via iframe tersembunyi (anti popup-blocker) --
function _printViaIframe(html){
  // buat/ambil iframe tersembunyi
  let iframe = document.getElementById('__print_iframe');
  if (!iframe){
    iframe = document.createElement('iframe');
    iframe.id = '__print_iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);
  }

  // tulis dokumen print ke dalam iframe
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cetak</title></head><body>${html}</body></html>`);
  doc.close();

  // copy CSS print yang sudah kita inject di parent
  const style = document.getElementById('print-style-a4-landscape');
  if (style){
    const s2 = doc.createElement('style');
    s2.textContent = style.textContent;
    doc.head.appendChild(s2);
  }

  // fokus & print
  setTimeout(()=>{
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  }, 50);
}


// ============= API yang kamu panggil =============
// Panggil setelah monitorHTML(...) ditempel ke DOM
export function enableReportPrint({ container, m, y, mode, key }){
  try{
    _ensurePrintStyleInjected();
    const card = container.querySelector('.card.moni');
    if (!card) return;
    // sisip tombol sekali
    if (!card.querySelector('#btn-print-report')){
      const bar = document.createElement('div');
      bar.className = 'no-print';
      bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-bottom:6px;';
      bar.innerHTML = `<button id="btn-print-report" class="secondary">Cetak PDF (A4)</button>`;
      // taruh sebelum heading agar rapih
      const h3 = card.querySelector('h3');
      card.insertBefore(bar, h3?.nextSibling || card.firstChild);
      bar.querySelector('#btn-print-report').addEventListener('click', ()=>{
        const headerInfo = _buildHeaderInfo({m,y,mode,key});
        const html = _buildPrintHTML({ rootEl: card, headerInfo });
        _printViaIframe(html); // ← tidak pakai popup, aman
      });
    }
  }catch(e){
    console.error('Print init error:', e);
  }
}
