// =====================
// File: features/settings.js (guard + JSONP fallback + Backup/Restore XLSX)
// =====================
import { $, ensureNumber, hash } from '../core/utils.js';
import { Keys, LStore, IStore } from '../core/storage.js';
import { API } from '../core/api.js';
import { Theme, getTheme, setTheme, applyTheme } from '../core/theme.js';
import { Progress } from '../core/progress.js';

// ---------- Utilities ----------
async function confirmDialog(message) {
  try { return !!window.confirm(message); } catch { return false; }
}
function hashPlain(p) {
  let h = 0; for (let i=0;i<p.length;i++){ h=(h*31 + p.charCodeAt(i))|0; } return String(h>>>0);
}

// ------- GAS base URL resolver (opsional, hanya untuk JSONP fallback) -------
function _gasBase() {
  const fromWindow = (typeof window!=='undefined' && window.GAS_BASE_URL) || '';
  const fromLS     = localStorage.getItem('API_BASE') || '';
  const base = (fromWindow || fromLS || '').replace(/\/$/,'');
  if (!base) throw new Error('JSONP fallback tidak dikonfigurasi (set window.GAS_BASE_URL atau localStorage "API_BASE").');
  if (/macros\/echo\b/.test(base)) console.error('URL GAS salah: jangan pakai /macros/echo — gunakan /exec.');
  return base;
}
function hasJSONPFallback() {
  return !!((typeof window!=='undefined' && window.GAS_BASE_URL) || localStorage.getItem('API_BASE'));
}
function gasJSONP(route, params = {}) {
  const base = _gasBase();
  return new Promise((resolve, reject) => {
    const cb = '__jsonp_cb_' + Math.random().toString(36).slice(2);
    const qs = new URLSearchParams({ ...params, route, callback: cb }).toString();
    const s = document.createElement('script'); let done = false;
    function cleanup(){ try{ delete window[cb]; }catch(_){} s.remove(); }
    window[cb] = (resp)=>{ done=true; resolve(resp); cleanup(); };
    s.onerror = ()=>{ if (!done){ reject(new Error('JSONP error')); cleanup(); } };
    s.src = `${base}?${qs}`; document.body.appendChild(s);
    setTimeout(()=>{ if(!done){ reject(new Error('JSONP timeout')); cleanup(); } }, 20000);
  });
}

// ---------- View ----------
function view(){
  return `
  <div class="card">
    <h2>Pengaturan</h2>
    <div class="onboard" id="onboard-guide">
      <b>Langkah awal sebelum menggunakan aplikasi:</b>
      <ol style="margin:8px 0 0 18px; padding:0">
        <li>Klik <b>Tarik Master</b> untuk mengunduh data master (blok, divisi, dll).</li>
        <li>Klik <b>Download Data Aktual → Lokal</b> agar input lebih cepat &amp; akurat.</li>
        <li>Mulai input di menu <b>Input</b>, lalu <b>Sinkronisasi</b> bila online.</li>
      </ol>
    </div>

    <div class="row" style="margin-top:12px">
      <div class="col">
        <label>Sesi Aktif</label>
        <div id="session-info" class="session-info">Belum login</div>
      </div>
      <div class="col" style="display:flex; align-items:flex-end">
        <button class="danger" id="btn-logout" type="button">Logout</button>
      </div>
    </div>

    <div class="row" style="margin-top:8px">
      <div class="col"><button id="btn-master-pull" class="primary">Tarik Master</button></div>
      <div class="col"><button id="btn-download-data" class="primary">Download Data Aktual → Lokal</button></div>
    </div>
    <div class="row">
      <div class="col">
        <label>Filter Tahun (Aktual)</label>
        <input id="flt-year" type="number" placeholder="2025" />
      </div>
      <div class="col">
        <label>Filter Estate (Aktual)</label>
        <select id="flt-estate" multiple size="5"></select>
        <div class="hint">Kosong / tidak dipilih = Semua Estate</div>
      </div>
    </div>
    <div class="row">
      <div class="col"><button class="danger" id="btn-reset-local">Reset Semua Data Lokal</button></div>
    </div>
  </div>

  <!-- SECTION: khusus ASISTEN (upload master) -->
  <div id="section-asisten" style="display:none">
    <div class="card" id="section-upload">
      <h3>Upload Master (Asisten)</h3>
      <p>Format didukung: <b>.xlsx</b>. Gunakan template di bawah.</p>
      <input type="file" id="file-master" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <div class="row">
        <div class="col"><button id="btn-upload-master">Upload Master (.xlsx)</button></div>
        <div class="col"><button id="btn-download-template">Download Template Master (.xlsx)</button></div>
      </div>
    </div>
  </div>

  <!-- SECTION: BACKUP & RESTORE (Backup: semua role, Restore: Admin/Asisten) -->
  <div class="card" id="section-backup">
    <h3>Backup & Restore (Lokal)</h3>
    <div class="row" style="gap:8px; align-items:center; flex-wrap:wrap">
      <button id="btn-export-xlsx">Export Data Lokal (.xlsx)</button>

      <input type="file" id="file-restore" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" />
      <button id="btn-import-xlsx">Restore dari .xlsx</button>
      <span class="muted" id="restore-note">(Restore hanya untuk Admin & Asisten)</span>
    </div>
  </div>
  `;
}

function renderSessionInfo(){
  const el = document.getElementById('session-info');
  if (!el) return;
  const role = (localStorage.getItem(Keys.ROLE)||'').toLowerCase();
  const nik  = localStorage.getItem(Keys.NIK) || '';
  const name = localStorage.getItem(Keys.NAME) || '';
  if (!role || role==='-'){ el.textContent = 'Belum login'; return; }
  const label = role==='admin'?'Admin':role==='asisten'?'Asisten':role==='advisor'?'Advisor':'Mandor';
  el.innerHTML = `<b>${label}</b> — ${name || nik}${nik?` (${nik})`:''}`;
}

// ---------- Section visibility ----------
function ensureAsistenSections(){
  const role = (localStorage.getItem(Keys.ROLE)||'-').toLowerCase();
  const wrap = document.getElementById('section-asisten');
  if (wrap) wrap.style.display = (role === 'asisten') ? 'block' : 'none';
}
// Restore hanya untuk Admin/Asisten (backup boleh semua)
function ensureBackupRestoreAccess(){
  const role = (localStorage.getItem(Keys.ROLE)||'-').toLowerCase();
  const btnImport = document.getElementById('btn-import-xlsx');
  const note      = document.getElementById('restore-note');
  if (!btnImport || !note) return;
  const allowed = (role==='admin' || role==='asisten');
  btnImport.style.display = allowed ? 'inline-block' : 'none';
  note.style.display      = 'inline-block';
  note.textContent        = allowed ? '(Restore oleh Admin/Asisten)' : '(Restore hanya untuk Admin & Asisten)';
}

// ====== XLSX Master Helpers ======
const MASTER_HEADERS = {
  company:['id','nama'],
  estate:['id','nama','company_id'],
  divisi:['id','kode','nama','estate_id'],
  kadvel:['id','nama','divisi_id'],
  blok  :['id','kode','nama','divisi_id','kadvel_id','luas_ha','mandor_nik','bjr_kg_per_jjg'],
  mandor:['nik','nama','divisi_id'],
  asisten:['nik','nama','divisi_id'],
  libur :['tanggal','keterangan'],
};
function _findSheet(wb,name){ if (wb.Sheets[name]) return wb.Sheets[name]; const lower=name.toLowerCase(); const n=wb.SheetNames.find(x=>String(x).toLowerCase()===lower); return n?wb.Sheets[n]:null; }
function _sheetToObjsWithHeader(ws, expected){
  const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  if (!aoa || aoa.length===0) return [];
  const hdrRow = aoa[0].map(x=>String(x).trim().toLowerCase());
  const need   = expected.map(h=>h.toLowerCase());
  const idxMap = {}; const miss=[];
  need.forEach(h=>{ const i=hdrRow.indexOf(h); if(i<0) miss.push(h); else idxMap[h]=i; });
  if (miss.length) throw new Error(`Header hilang: ${miss.join(', ')}`);
  const out=[]; for (let r=1;r<aoa.length;r++){
    const row=aoa[r]; if(!row || row.every(v=>v===''||v==null)) continue;
    const obj={}; need.forEach(h=> obj[h] = row[idxMap[h]] ?? '' );
    const norm={}; expected.forEach((H,j)=> norm[H] = obj[need[j]] );
    out.push(norm);
  }
  return out;
}
async function parseMasterXLSX(file){
  if (!file) throw new Error('File tidak dipilih');
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type:'array' });
  const result={};
  for (const [key, headers] of Object.entries(MASTER_HEADERS)){
    const ws = _findSheet(wb, key);
    if (!ws){ result[key]=[]; continue; }
    const arr = _sheetToObjsWithHeader(ws, headers);
    if (key==='blok'){
      arr.forEach(b=>{
        b.luas_ha = Number(b.luas_ha||0);
        b.bjr_kg_per_jjg = Number(b.bjr_kg_per_jjg||0);
      });
    }
    result[key]=arr;
  }
  return result;
}

async function applyMasterJSON(j){
  if (j.company) await IStore.setArr(Keys.MASTER_COMPANY, j.company);
  if (j.estate)  await IStore.setArr(Keys.MASTER_ESTATE,  j.estate);
  if (j.divisi)  await IStore.setArr(Keys.MASTER_DIVISI,  j.divisi);
  if (j.kadvel)  await IStore.setArr(Keys.MASTER_KADVEL,  j.kadvel);
  if (j.blok)    await IStore.setArr(Keys.MASTER_BLOK,    j.blok);
  if (j.mandor)  await IStore.setArr(Keys.MASTER_MANDOR,  j.mandor);
  if (j.asisten) await IStore.setArr(Keys.MASTER_ASISTEN, j.asisten);
  if (j.libur)   await IStore.setArr(Keys.MASTER_LIBUR,   j.libur);
}

function downloadMasterTemplateXLSX(){
  if (typeof XLSX === 'undefined'){ alert('Library XLSX belum termuat'); return; }
  const samples = {
    company:[['PT1','PT SENTRA KARYA MANUNGGAL']],
    estate :[['EST1','Seriang Estate','PT1']],
    divisi :[['DIV1','SRIE1','SRIE1','EST1']],
    kadvel :[['K1','D-1','DIV1']],
    blok   :[['B1','A-01','A-01','DIV1','K1',25,'111',18]],
    mandor :[['111','Budi','DIV1']],
    asisten:[['222','Fery','DIV1']],
    libur  :[['2025-01-01','Tahun Baru']],
  };
  const wb = XLSX.utils.book_new();
  for (const [sheet, headers] of Object.entries(MASTER_HEADERS)){
    const body = samples[sheet] || [];
    const data = [headers, ...body];
    const ws   = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = headers.map((h,i)=>{
      const maxLen = Math.max(String(h).length, ...data.map(r=> String(r[i]??'').length));
      return { wch: Math.max(10, maxLen+2) };
    });
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  XLSX.writeFile(wb, 'template_master.xlsx');
}

// ===== BACKUP / RESTORE XLSX (LocalStorage) =====
const INPUT_HEADERS = [
  'local_id','server_id','nik_mandor','nama_mandor','divisi_id','blok_id','kadvel_id',
  'tanggal','luas_panen_ha','jjg','brondolan_kg','hk','tonase_ton',
  'catatan','sync_status','created_at','updated_at'
];
const QUEUE_HEADERS = ['local_id'];
const USER_DIVISI_HEADERS = ['divisi_id'];

function _appendSheet(wb, sheetName, headers, rows){
  const body = Array.isArray(rows) ? rows : [];
  const aoa  = [headers, ...body.map(o => headers.map(h => (o && o[h] != null) ? o[h] : ''))];
  const ws   = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h, i)=>{
    const maxLen = Math.max(String(h).length, ...body.map(r => String(r && r[headers[i]] != null ? r[headers[i]] : '').length));
    return { wch: Math.min(Math.max(10, maxLen + 2), 60) };
  });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

async function exportLocalAsXLSX(){
  if (typeof XLSX === 'undefined'){ showToast('Library XLSX belum termuat'); return; }
  const pickArr = async (k)=> (await IStore.getArr(k).catch(()=>[])) || [];

  const master  = {
    company: await pickArr(Keys.MASTER_COMPANY),
    estate : await pickArr(Keys.MASTER_ESTATE),
    divisi : await pickArr(Keys.MASTER_DIVISI),
    kadvel : await pickArr(Keys.MASTER_KADVEL),
    blok   : await pickArr(Keys.MASTER_BLOK),
    mandor : await pickArr(Keys.MASTER_MANDOR),
    asisten: await pickArr(Keys.MASTER_ASISTEN),
    libur  : await pickArr(Keys.MASTER_LIBUR),
  };

  const inputRecords = await pickArr(Keys.INPUT_RECORDS);
  const syncQueue    = await pickArr(Keys.SYNC_QUEUE);
  let userDivisi     = [];
  try{
    const raw = localStorage.getItem(Keys.USER_DIVISI) || '[]';
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) userDivisi = arr.map(x=>({divisi_id:String(x)}));
  }catch(_){}

  const wb = XLSX.utils.book_new();

  const meta = [{
    exported_at: new Date().toISOString(),
    role: (localStorage.getItem(Keys.ROLE)||'-'),
    nik : (localStorage.getItem(Keys.NIK)||''),
    name: (localStorage.getItem(Keys.NAME)||''),
    app : 'RTPN Local Backup'
  }];
  _appendSheet(wb, 'meta', Object.keys(meta[0]), meta);

  const h = MASTER_HEADERS;
  if (master.company.length) _appendSheet(wb, 'company', h.company, master.company);
  if (master.estate.length)  _appendSheet(wb, 'estate',  h.estate,  master.estate);
  if (master.divisi.length)  _appendSheet(wb, 'divisi',  h.divisi,  master.divisi);
  if (master.kadvel.length)  _appendSheet(wb, 'kadvel',  h.kadvel,  master.kadvel);
  if (master.blok.length)    _appendSheet(wb, 'blok',    h.blok,    master.blok);
  if (master.mandor.length)  _appendSheet(wb, 'mandor',  h.mandor,  master.mandor);
  if (master.asisten.length) _appendSheet(wb, 'asisten', h.asisten, master.asisten);
  if (master.libur.length)   _appendSheet(wb, 'libur',   h.libur,   master.libur);

  if (inputRecords.length) _appendSheet(wb, 'input_records', INPUT_HEADERS, inputRecords);
  if (syncQueue.length)    _appendSheet(wb, 'sync_queue',    QUEUE_HEADERS, syncQueue.map(id=>({local_id:id})));
  if (userDivisi.length)   _appendSheet(wb, 'user_divisi',   USER_DIVISI_HEADERS, userDivisi);

  const fname = `backup-rtpn-${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, fname);
  showToast('Backup .xlsx dibuat');
}

async function restoreFromBackupXLSX(file){
  if (typeof XLSX === 'undefined') throw new Error('Library XLSX belum termuat');
  if (!file) throw new Error('Pilih file .xlsx');

  const role = (localStorage.getItem(Keys.ROLE)||'-').toLowerCase();
  if (!(role==='admin' || role==='asisten')) throw new Error('Restore hanya untuk Admin & Asisten');

  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type:'array' });

  const readSheet = (name, headers)=>{
    const ws = _findSheet(wb, name);
    if (!ws) return [];
    return _sheetToObjsWithHeader(ws, headers);
  };

  // --- MASTER ---
  const m = {};
  for (const [sheet, headers] of Object.entries(MASTER_HEADERS)){
    m[sheet] = readSheet(sheet, headers);
  }
  if (m.blok && m.blok.length){
    m.blok.forEach(b=>{
      b.luas_ha = Number(b.luas_ha||0);
      b.bjr_kg_per_jjg = Number(b.bjr_kg_per_jjg||0);
    });
  }

  // --- INPUT RECORDS ---
  const restoredInputs = readSheet('input_records', INPUT_HEADERS).map(r=>({
    local_id: r.local_id || '',
    server_id: r.server_id || '',
    nik_mandor: r.nik_mandor || '',
    nama_mandor: r.nama_mandor || '',
    divisi_id: r.divisi_id || '',
    blok_id: r.blok_id || '',
    kadvel_id: r.kadvel_id || '',
    tanggal: r.tanggal || '',
    luas_panen_ha: ensureNumber(r.luas_panen_ha,0),
    jjg: ensureNumber(r.jjg,0),
    brondolan_kg: ensureNumber(r.brondolan_kg,0),
    hk: ensureNumber(r.hk,0),
    tonase_ton: ensureNumber(r.tonase_ton,0),
    catatan: r.catatan || '',
    sync_status: r.sync_status || 'synced',
    created_at: r.created_at || '',
    updated_at: r.updated_at || '',
  }));

  const restoredQueue = readSheet('sync_queue', QUEUE_HEADERS)
    .map(r=> String(r.local_id||''))
    .filter(Boolean);

  const userDivisiRows = readSheet('user_divisi', USER_DIVISI_HEADERS);
  const userDivisi = userDivisiRows.map(x=> String(x.divisi_id||'')).filter(Boolean);

  // --- SIMPAN MASTER ke IndexedDB ---
  const mapKey = {
    company: Keys.MASTER_COMPANY,
    estate : Keys.MASTER_ESTATE,
    divisi : Keys.MASTER_DIVISI,
    kadvel : Keys.MASTER_KADVEL,
    blok   : Keys.MASTER_BLOK,
    mandor : Keys.MASTER_MANDOR,
    asisten: Keys.MASTER_ASISTEN,
    libur  : Keys.MASTER_LIBUR
  };

  for (const [k, arr] of Object.entries(m)){
    if (Array.isArray(arr) && arr.length && mapKey[k]){
      await IStore.setArr(mapKey[k], arr);
    }
  }

  // --- SIMPAN DATA AKTUAL & QUEUE ---
  if (restoredInputs.length) await IStore.setArr(Keys.INPUT_RECORDS, restoredInputs);
  await IStore.setArr(Keys.SYNC_QUEUE, restoredQueue); // simpan walau kosong

  if (userDivisi.length) localStorage.setItem(Keys.USER_DIVISI, JSON.stringify(userDivisi));

  showToast('Restore selesai. Memuat ulang…');
  setTimeout(()=> location.reload(), 250);
}

async function fillEstateOptions(){
  const sel = $('#flt-estate');
  if (!sel) return;

  const estates = (await IStore.getArr(Keys.MASTER_ESTATE).catch(()=>[])) || [];
  // sort biar rapi
  estates.sort((a,b)=> String(a.nama||a.id).localeCompare(String(b.nama||b.id)));

  if (!estates.length){
    sel.innerHTML = '';
    sel.disabled = true;
    sel.insertAdjacentHTML('beforeend', `<option value="">(Belum ada data estate — tarik master dulu)</option>`);
    return;
  }

  sel.disabled = false;
  sel.innerHTML = estates.map(e =>
    `<option value="${String(e.id)}">${String(e.nama||e.id)}</option>`
  ).join('');
}

// Optional: set default tahun agar kelihatan terisi dan enak dipakai
function ensureDefaultYear(){
  const inp = $('#flt-year');
  if (!inp) return;
  if (!String(inp.value||'').trim()){
    inp.value = String(new Date().getFullYear());
  }
}

async function refreshFilterUI(){
  ensureDefaultYear();
  await fillEstateOptions();
}

// ---------- Bind utama ----------
function bind(){
  // Theme toggle (opsional, bila ada switch di header)
  const chkDark = $('#toggle-dark');
  if (chkDark){
    chkDark.checked = (getTheme() === Theme.DARK);
    chkDark.addEventListener('change', ()=>{
      setTheme(chkDark.checked ? Theme.DARK : Theme.LIGHT);
      applyTheme();
      showToast(`Tema diubah ke ${chkDark.checked ? 'Dark' : 'Light'}`);
    });
  }

  ensureAsistenSections();
  ensureBackupRestoreAccess();
  renderSessionInfo();
  refreshFilterUI().catch(console.warn);

  // LOGOUT
  document.getElementById('btn-logout')?.addEventListener('click', ()=>{
    if (!confirm('Logout dari sesi ini?')) return;
    [Keys.ROLE, Keys.NIK, Keys.NAME, Keys.TOKEN, Keys.USER_DIVISI].forEach(k=>{
      try{ localStorage.removeItem(k); }catch(_){}
    });
    showToast('Anda telah logout');
    // muat ulang agar gerbang login muncul kembali
    location.hash = '#/settings';
    location.reload();
  });

  // TARIK MASTER (fetch → fallback JSONP)
  $('#btn-master-pull').addEventListener('click', async ()=>{
    const role = localStorage.getItem(Keys.ROLE) || '-';
    const nik  = localStorage.getItem(Keys.NIK)  || '';
    if (role==='-') return showToast('Set role dulu');
    try{
      Progress.open({ title:'Tarik Master Data', subtitle:'Meminta data…' });
      let data;
      try{
        const res = await API.masterPull({ role, nik });
        if (!res.ok) throw new Error(res.error || 'fetch gagal');
        data = res.data || {};
      }catch(errFetch){
        if (!hasJSONPFallback()) throw errFetch;
        const r = await gasJSONP('master.pull', {
          role, nik,
          nik_auth: localStorage.getItem(Keys.NIK)||'',
          token:    localStorage.getItem(Keys.TOKEN)||'',
        });
        if (!r || !r.ok) throw new Error(r?.error || 'Gagal tarik master (JSONP)');
        data = r.data || {};
      }
      const MAP = {
        company: Keys.MASTER_COMPANY,
        estate : Keys.MASTER_ESTATE,
        divisi : Keys.MASTER_DIVISI,
        kadvel : Keys.MASTER_KADVEL,
        blok   : Keys.MASTER_BLOK,
        mandor : Keys.MASTER_MANDOR,
        asisten: Keys.MASTER_ASISTEN,
        libur  : Keys.MASTER_LIBUR,
      };
      const keys = Object.keys(MAP);
      Progress.switchToDeterminate(keys.length);

      for (let i=0; i<keys.length; i++){
        const k = keys[i];
        Progress.update(`Menyimpan ${k}…`);
        await IStore.setArr(MAP[k], Array.isArray(data[k]) ? data[k] : []);
        Progress.tick(i+1, keys.length);
      }
      Progress.update('Selesai');
      await refreshFilterUI();
      showToast('Master tersimpan ke lokal');
    }catch(e){
      showToast(e.message || 'Gagal tarik master');
    }finally{
      Progress.close();
    }
  });

  // DOWNLOAD DATA AKTUAL → ke lokal (fetch → fallback JSONP)
  $('#btn-download-data').addEventListener('click', async ()=>{
    const role = localStorage.getItem(Keys.ROLE) || '-';
    const nik  = localStorage.getItem(Keys.NIK)  || '';
    if (role==='-') return showToast('Set role dulu');
    try{
      Progress.open({ title:'Download Data Aktual', subtitle:'Meminta ke server…' });
      const month = ''; // <-- FIX: agar JSONP tidak error (month undefined)
      const year = ($('#flt-year')?.value || '').trim(); // boleh kosong = semua tahun

      const estateSel = $('#flt-estate');
      const estate_ids = estateSel
        ? Array.from(estateSel.selectedOptions).map(o=>o.value).filter(Boolean).join(',')
        : '';

      let rows = [];
      try{
        const res = await API.actualPull({ month, year, estate_ids }); // month sekarang variabel
        if (!res.ok) throw new Error(res.error || 'fetch gagal');
        rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
      }catch(errFetch){
        if (!hasJSONPFallback()) throw errFetch;
        const r = await gasJSONP('actual.pull', {
          role, nik, month, year, estate_ids, // <-- sertakan estate_ids juga kalau endpoint mendukung
          nik_auth: localStorage.getItem(Keys.NIK)||'',
          token:    localStorage.getItem(Keys.TOKEN)||'',
        });
        if (!r || !r.ok) throw new Error(r?.error || 'Gagal download (JSONP)');
        rows = Array.isArray(r.data?.rows) ? r.data.rows : [];
      }

      const normalized = rows.map(r=>{
        const local_id = r.local_id || hash(`${r.nik_mandor||''}|${r.tanggal||''}|${r.blok_id||''}`);
        const created  = r.created_at || r.updated_at || new Date().toISOString();
        const updated  = r.updated_at || created;
        return {
          local_id,
          server_id: r.server_id || '',
          nik_mandor: r.nik_mandor || '',
          nama_mandor: r.nama_mandor || '',
          divisi_id: r.divisi_id || '',
          blok_id: r.blok_id || '',
          kadvel_id: r.kadvel_id || '',
          tanggal: r.tanggal || '',
          luas_panen_ha: ensureNumber(r.luas_panen_ha,0),
          jjg: ensureNumber(r.jjg,0),
          brondolan_kg: ensureNumber(r.brondolan_kg,0),
          hk: ensureNumber(r.hk,0),
          tonase_ton: ensureNumber(r.tonase_ton,0),
          catatan: r.catatan || '',
          sync_status: 'synced',
          created_at: created,
          updated_at: updated,
        };
      });

      Progress.switchToDeterminate(Math.max(1, normalized.length));
      Progress.update('Menyimpan ke lokal…');

      const map = new Map();
      (LStore.getArr(Keys.INPUT_RECORDS)||[]).forEach(x=> map.set(x.local_id,x));
      normalized.forEach((x,i)=>{ map.set(x.local_id,x); if ((i+1)%50===0) Progress.tick(i+1, normalized.length); });
      Progress.tick(normalized.length, normalized.length);

      const merged = [...map.values()].sort((a,b)=> a.tanggal>b.tanggal ? -1 : 1);
      await IStore.setArr(Keys.INPUT_RECORDS, merged);

      const qOld = new Set(await IStore.getArr(Keys.SYNC_QUEUE));
      normalized.forEach(x=> qOld.delete(x.local_id));
      await IStore.setArr(Keys.SYNC_QUEUE, [...qOld]);

      Progress.update('Selesai');
      showToast(`Data aktual terunduh: ${normalized.length} baris`);
    }catch(e){
      showToast(e.message || 'Gagal mengunduh data');
    }finally{
      Progress.close();
    }
  });

  // RESET LOKAL
  $('#btn-reset-local').addEventListener('click', async ()=>{
  if (!confirm('Hapus SEMUA data lokal (IndexedDB) aplikasi Pusingan Panen?')) return;
  try{
    await IStore.clearDatabase();
    showToast('✅ IndexedDB aplikasi sudah dibersihkan');
  }catch(e){
    showToast('Gagal reset: ' + (e.message||e));
  }
});

  // TEMPLATE MASTER
  $('#btn-download-template').addEventListener('click', ()=>{
    try{ downloadMasterTemplateXLSX(); }catch(e){ showToast(e.message||'Gagal membuat template'); }
  });

  // UPLOAD MASTER (Asisten)
  $('#btn-upload-master').addEventListener('click', async ()=>{
    const f = document.getElementById('file-master').files?.[0];
    if (!f) return showToast('Pilih file .xlsx');
    try{
      Progress.open({ title:'Upload Master', subtitle:'Membaca file…' });
      const parsed = await parseMasterXLSX(f);

      if (Array.isArray(parsed.blok)){
        for (const b of parsed.blok){
          if (!b.kadvel_id) throw new Error(`kadvel_id wajib pada blok ${b.kode||b.id||'(tanpa kode)'}`);
          if (b.bjr_kg_per_jjg == null || Number(b.bjr_kg_per_jjg) <= 0) {
            throw new Error(`BJR tidak valid pada blok ${b.kode||b.id||'(tanpa kode)'}`);
          }
        }
      }

      const parts = Object.keys(parsed);
      Progress.switchToDeterminate(parts.length + 1);

      let step = 0;
      for (const k of parts){
        Progress.update(`Menyimpan ${k}…`);
        await applyMasterJSON({ [k]: parsed[k] }); // <-- FIX: tunggu benar-benar tersimpan
        step++;
        Progress.tick(step, parts.length + 1);
      }
      await refreshFilterUI();

      Progress.update('Mengunggah (bulk)…');
      let pushed = false;
      try{
        const compact = Object.fromEntries( Object.entries(parsed).filter(([_,arr])=> Array.isArray(arr)&&arr.length>0) );
        const res = await API.masterPush({ items: compact });
        if (!res || !res.ok) throw new Error(res?.error || 'bulk gagal');
        pushed = true;
      }catch(_bulkErr){
        if (!hasJSONPFallback()) throw _bulkErr;
        const order = ['company','estate','divisi','kadvel','blok','mandor','asisten','libur'];
        const present = order.filter(k=> Array.isArray(parsed[k]) && parsed[k].length );
        Progress.switchToDeterminate(present.length);

        const nik_auth = localStorage.getItem(Keys.NIK)   || '';
        const token    = localStorage.getItem(Keys.TOKEN) || '';

        let i=0;
        for (const k of order){
          const arr = parsed[k]; if (!Array.isArray(arr) || !arr.length) continue;
          i++; Progress.update(`Upload ${k}…`);
          const r = await gasJSONP('master.push', { payload: JSON.stringify({ [k]:arr }), nik_auth, token });
          if (!r || !r.ok) throw new Error(r?.error || `Gagal unggah ${k}`);
          Progress.tick(i, present.length);
        }
        pushed = true;
      }

      Progress.update('Selesai');
      if (pushed) showToast('Master .xlsx tersimpan (lokal & server)');
    }catch(e){
      showToast(e.message || 'Gagal memproses file .xlsx');
    }finally{
      Progress.close();
    }
  });

  // === Backup/Restore ===
  document.getElementById('btn-export-xlsx')?.addEventListener('click', async ()=>{
    try{
      Progress.open({ title:'Backup', subtitle:'Menyiapkan file .xlsx…' });
      await exportLocalAsXLSX();
    }catch(e){ console.warn(e); 
      showToast(e.message || 'Gagal backup');
    }finally{
      Progress.close();
    }
  });

  document.getElementById('btn-import-xlsx').addEventListener('click', ()=>{
    const role = (localStorage.getItem(Keys.ROLE)||'-').toLowerCase();
    if (!(role==='admin' || role==='asisten')){ showToast('Restore hanya untuk Admin & Asisten'); return; }
    document.getElementById('file-restore').click();
  });
  document.getElementById('file-restore').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    try{
      Progress.open({ title:'Restore', subtitle:'Memproses .xlsx…' });
      await restoreFromBackupXLSX(f);
    }catch(err){
      showToast(err.message || 'Gagal restore');
    }finally{
      Progress.close();
      e.target.value = '';
    }
  });
}

export function render(app){ app.innerHTML = view(); bind(); }
