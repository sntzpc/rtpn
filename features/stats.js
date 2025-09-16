// =====================
// File: features/stats.js
// =====================
import { $, ensureNumber } from '../core/utils.js';
import { Keys, LStore } from '../core/storage.js';

// Ambil angka pertama yang valid (>0) dari beberapa nama field
function _firstNum(obj, keys){
  for (const k of keys){
    const v = ensureNumber(obj?.[k], 0);
    if (v > 0) return v;
  }
  return 0;
}

// BJR dari master blok (mencoba beberapa kemungkinan nama kolom)
function _bjrFromMaster(blok_id){
  const blk = (LStore.getArr(Keys.MASTER_BLOK) || [])
    .find(x => String(x.id) === String(blok_id));
  if (!blk) return 0;
  return _firstNum(blk, ['bjr','bjr_kg','bjrKg','rata_bjr','rataBjr','avg_bjr','bjr_kg_per_jjg']);
}


// ambil BJR dari master blok bila record tidak menyimpan field bjr
function _bjrOf(blok_id){
  const b = (LStore.getArr(Keys.MASTER_BLOK) || [])
    .find(x => String(x.id) === String(blok_id));
  return ensureNumber(b?.bjr, 0); // kg/tandan
}

function monthOptions(){
  return Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
}
function yearOptions(){
  const years = new Set();
  const recs = LStore.getArr(Keys.INPUT_RECORDS);
  recs.forEach(r=> years.add((r.tanggal||'').slice(0,4)) );
  const arr = [...years].filter(Boolean).sort();
  const current = new Date().getFullYear();
  if (!arr.includes(String(current))) arr.push(String(current));
  return arr.map(y=>`<option value="${y}">${y}</option>`).join('');
}
function divisiOptions(){
  const divisi = LStore.getArr(Keys.MASTER_DIVISI) || [];
  return '<option value="">Semua Divisi</option>' + divisi
    .map(d=>`<option value="${d.id}">${d.nama||d.kode||d.id}</option>`).join('');
}

function view(){
  return `
  <div class="card">
    <h2>Statistik Produksi (Read-only)</h2>
    <div class="row">
      <div class="col"><label>Bulan</label><select id="s-month">${monthOptions()}</select></div>
      <div class="col"><label>Tahun</label><select id="s-year">${yearOptions()}</select></div>
      <div class="col"><label>Divisi</label><select id="s-divisi">${divisiOptions()}</select></div>
      <div class="col"><label>Top N</label><input id="s-topn" type="number" min="1" max="50" value="3"/></div>
      <div class="col"><button class="primary" id="s-run">Hitung</button></div>
    </div>
  </div>

  <div class="kpi" id="s-kpi"></div>

  <div class="row">
    <div class="col">
      <div class="card">
        <h3>Top Hari Produksi (Tonase)</h3>
        <div id="top-days"></div>
      </div>
    </div>
    <div class="col">
      <div class="card">
        <h3>Mandor dengan Produksi Tertinggi (Tonase)</h3>
        <div id="top-mandor"></div>
      </div>
    </div>
  </div>`;
}

function getFilters(){
  const month  = Number($('#s-month').value);
  const year   = Number($('#s-year').value);
  const divisi = $('#s-divisi').value || '';
  let topn     = Number($('#s-topn').value);
  if (!Number.isFinite(topn) || topn<1) topn = 3;
  return { month, year, divisi, topn };
}

function filterRecords(month, year, divisiId){
  return (LStore.getArr(Keys.INPUT_RECORDS) || []).filter(r=>{
    if (!r.tanggal) return false;
    const y = r.tanggal.slice(0,4);
    const m = Number(r.tanggal.slice(5,7));
    if (String(y)!==String(year) || Number(m)!==Number(month)) return false;
    if (divisiId && String(r.divisi_id)!==String(divisiId)) return false;
    return true;
  });
}

function computeTopDays(recs, topn){
  const byDate = {};
  recs.forEach(r=>{
    const t = ensureNumber(r.tonase_ton,0);
    byDate[r.tanggal] = (byDate[r.tanggal]||0) + t;
  });
  return Object.entries(byDate)
    .sort((a,b)=> b[1]-a[1])
    .slice(0, topn)
    .map(([date, ton])=>({ date, ton:+ton.toFixed(2) }));
}

function computeTopMandor(recs, topn){
  const byMandor = {};
  recs.forEach(r=>{
    const key = (r.nama_mandor||r.nik_mandor||'MANDOR');
    const t = ensureNumber(r.tonase_ton,0);
    byMandor[key] = (byMandor[key]||0) + t;
  });
  return Object.entries(byMandor)
    .map(([name, ton])=>({ name, ton:+ton.toFixed(2) }))
    .sort((a,b)=> b.ton-a.ton)
    .slice(0, topn);
}

function summarize(recs){
  const s = recs.reduce((a, r) => {
    a.days.add(r.tanggal);

    const ton = ensureNumber(r.tonase_ton, 0);
    const hk  = ensureNumber(r.hk, 0);
    const ha  = ensureNumber(r.luas_panen_ha, 0);
    const jjg = ensureNumber(r.jjg, 0);

    // brondolan: dukung beberapa nama field
    const br = _firstNum(r, ['brondolan_kg','br_kg','brondolan']);

    // BJR prioritas: dari record → master blok → infer dari tonase & jjg
    let bjr = _firstNum(r, ['bjr','bjr_kg','bjrKg','rata_bjr','rataBjr']);
    if (!bjr) bjr = _bjrFromMaster(r.blok_id);
    if (!bjr && ton > 0 && jjg > 0) bjr = (ton * 1000) / jjg; // kg/jjg

    a.ton   += ton;
    a.hk    += hk;
    a.luas  += ha;
    a.jjg   += jjg;

    // Akumulasi %LF tertimbang
    a.sumBr  += br;          // kg
    a.sumDen += jjg * bjr;   // kg
    return a;
  }, { days:new Set(), ton:0, hk:0, luas:0, jjg:0, sumBr:0, sumDen:0 });

  const nDays = s.days.size;
  const thk   = s.hk   > 0 ? (s.ton / s.hk)   : 0;
  const tha   = s.luas > 0 ? (s.ton / s.luas) : 0;
  const avg   = nDays  > 0 ? (s.ton / nDays)  : 0;
  const lfPct = s.sumDen > 0 ? (s.sumBr / s.sumDen) * 100 : 0;

  return {
    totalTon:     +s.ton.toFixed(2),
    totalHK:      +s.hk.toFixed(2),
    totalLuas:    +s.luas.toFixed(2),
    totalJJG:     +s.jjg.toFixed(0),
    days:          nDays,
    tonPerHK:     +thk.toFixed(2),
    tonPerHa:     +tha.toFixed(2),
    avgTonPerDay: +avg.toFixed(2),
    lfPct:        +lfPct.toFixed(2),
  };
}


function kpiHTML(k){
  return `
    <div class="card"><b>Total Tonase</b><div class="badge">${k.totalTon} ton</div></div>
    <div class="card"><b>%LF</b><div class="badge">${k.lfPct} %</div></div>
    <div class="card"><b>Total HK</b><div class="badge">${k.totalHK}</div></div>
    <div class="card"><b>Total Luas</b><div class="badge">${k.totalLuas} ha</div></div>
    <div class="card"><b>Total JJG</b><div class="badge">${k.totalJJG}</div></div>
    <div class="card"><b>Hari Terdata</b><div class="badge">${k.days}</div></div>
    <div class="card"><b>Ton/HK</b><div class="badge">${k.tonPerHK}</div></div>
    <div class="card"><b>Ton/Ha</b><div class="badge">${k.tonPerHa}</div></div>
    <div class="card"><b>Rata2 Ton/Hari</b><div class="badge">${k.avgTonPerDay}</div></div>
  `;
}


function tableDays(list){
  if (!list.length) return '<i>Data kosong</i>';
  return `
  <table class="table">
    <thead><tr><th>#</th><th>Tanggal</th><th>Tonase</th></tr></thead>
    <tbody>
      ${list.map((x,i)=>`<tr><td>${i+1}</td><td>${x.date}</td><td>${x.ton}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

function tableMandor(list){
  if (!list.length) return '<i>Data kosong</i>';
  return `
  <table class="table">
    <thead><tr><th>#</th><th>Mandor</th><th>Tonase</th></tr></thead>
    <tbody>
      ${list.map((x,i)=>`<tr><td>${i+1}</td><td>${x.name}</td><td>${x.ton}</td></tr>`).join('')}
    </tbody>
  </table>`;
}

function run(){
  const { month, year, divisi, topn } = getFilters();
  const recs = filterRecords(month, year, divisi);
  const k = summarize(recs);
  $('#s-kpi').innerHTML = kpiHTML(k);
  $('#top-days').innerHTML = tableDays( computeTopDays(recs, topn) );
  $('#top-mandor').innerHTML = tableMandor( computeTopMandor(recs, topn) );
}

function bind(){
  // Prefill selector Tahun (harus setelah render view)
  $('#s-year').innerHTML = yearOptions();
  $('#s-divisi').innerHTML = divisiOptions();

  $('#s-run').addEventListener('click', run);

  // Jalankan sekali dengan default
  run();
}

export function render(app){ app.innerHTML = view(); bind(); }
