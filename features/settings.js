// =====================
// File: features/settings.js (guard + JSONP fallback + Backup/Restore XLSX)
// =====================
import { $, ensureNumber, hash } from '../core/utils.js';
import { Keys, LStore } from '../core/storage.js';
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
    <div class="row">
      <div class="col">
        <label>Role Aktif</label>
        <select id="set-role">
          <option value="-">- pilih -</option>
          <option value="mandor">Mandor</option>
          <option value="asisten">Asisten</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="col">
        <label>NIK</label>
        <input id="set-nik" placeholder="NIK" />
      </div>
      <div class="col">
        <label>Password</label>
        <input id="set-pass" type="password" placeholder="password" />
      </div>
    </div>
    <div class="row">
      <div class="col"><button class="primary" id="btn-login">Login (Set Role)</button></div>
      <div class="col"><button id="btn-master-pull">Tarik Master</button></div>
      <div class="col"><button id="btn-download-data">Download Data Aktual → Lokal</button></div>
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
function applyMasterJSON(j){
  if (j.company) LStore.setArr(Keys.MASTER_COMPANY, j.company);
  if (j.estate)  LStore.setArr(Keys.MASTER_ESTATE, j.estate);
  if (j.divisi)  LStore.setArr(Keys.MASTER_DIVISI, j.divisi);
  if (j.kadvel)  LStore.setArr(Keys.MASTER_KADVEL, j.kadvel);
  if (j.blok)    LStore.setArr(Keys.MASTER_BLOK, j.blok);
  if (j.mandor)  LStore.setArr(Keys.MASTER_MANDOR, j.mandor);
  if (j.asisten) LStore.setArr(Keys.MASTER_ASISTEN, j.asisten);
  if (j.libur)   LStore.setArr(Keys.MASTER_LIBUR, j.libur);
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

function exportLocalAsXLSX(){
  if (typeof XLSX === 'undefined'){ showToast('Library XLSX belum termuat'); return; }
  const pickArr = (k)=> LStore.getArr(k) || [];
  const master  = {
    company: pickArr(Keys.MASTER_COMPANY),
    estate : pickArr(Keys.MASTER_ESTATE),
    divisi : pickArr(Keys.MASTER_DIVISI),
    kadvel : pickArr(Keys.MASTER_KADVEL),
    blok   : pickArr(Keys.MASTER_BLOK),
    mandor : pickArr(Keys.MASTER_MANDOR),
    asisten: pickArr(Keys.MASTER_ASISTEN),
    libur  : pickArr(Keys.MASTER_LIBUR),
  };
  const inputRecords = pickArr(Keys.INPUT_RECORDS);
  const syncQueue    = pickArr(Keys.SYNC_QUEUE);
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

  const m = {};
  Object.entries(MASTER_HEADERS).forEach(([sheet, headers])=>{
    m[sheet] = readSheet(sheet, headers);
  });
  if (m.blok && m.blok.length){
    m.blok.forEach(b=>{
      b.luas_ha = Number(b.luas_ha||0);
      b.bjr_kg_per_jjg = Number(b.bjr_kg_per_jjg||0);
    });
  }

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
  const restoredQueue = readSheet('sync_queue', QUEUE_HEADERS).map(r=> String(r.local_id||'') ).filter(Boolean);

  const userDivisiRows = readSheet('user_divisi', USER_DIVISI_HEADERS);
  const userDivisi = userDivisiRows.map(x=> String(x.divisi_id||'')).filter(Boolean);

  Object.entries(m).forEach(([k, arr])=>{
    if (Array.isArray(arr) && arr.length){
      const map = {
        company: Keys.MASTER_COMPANY, estate: Keys.MASTER_ESTATE, divisi: Keys.MASTER_DIVISI,
        kadvel: Keys.MASTER_KADVEL, blok: Keys.MASTER_BLOK, mandor: Keys.MASTER_MANDOR,
        asisten: Keys.MASTER_ASISTEN, libur: Keys.MASTER_LIBUR
      };
      if (map[k]) LStore.setArr(map[k], arr);
    }
  });
  if (restoredInputs.length) LStore.setArr(Keys.INPUT_RECORDS, restoredInputs);
  if (restoredQueue.length)  LStore.setArr(Keys.SYNC_QUEUE,    restoredQueue);
  if (userDivisi.length) localStorage.setItem(Keys.USER_DIVISI, JSON.stringify(userDivisi));

  showToast('Restore selesai. Memuat ulang…');
  setTimeout(()=> location.reload(), 250);
}

// ---------- Bind utama ----------
function bind(){
  // Prefill
  $('#set-role').value = localStorage.getItem(Keys.ROLE) || '-';
  $('#set-nik').value  = localStorage.getItem(Keys.NIK)  || '';

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

  // LOGIN
  $('#btn-login').addEventListener('click', async ()=>{
    const role = ($('#set-role').value||'').toLowerCase();
    const nik  = ($('#set-nik').value||'').trim();
    const pass = $('#set-pass').value;
    if (!role || role==='-') return showToast('Pilih role');
    if (!nik || !pass)       return showToast('NIK & Password wajib');

    try{
      spinner(true);
      const pass_hash = hashPlain(pass);
      const res = await API.login({ nik, pass_hash, role });
      if (!res.ok) throw new Error(res.error || 'Login gagal');

      localStorage.setItem(Keys.ROLE, role);
      localStorage.setItem(Keys.NIK,  nik);
      localStorage.setItem(Keys.NAME, res.data?.name || (role==='admin' ? 'Admin' : role==='asisten' ? 'Asisten' : 'Mandor'));
      localStorage.setItem(Keys.TOKEN, pass_hash);

      if (role==='asisten'){
        const arr = LStore.getArr(Keys.MASTER_ASISTEN) || [];
        const me  = arr.find(a => String(a.nik)===String(nik));
        const divList = me && me.divisi_id ? [String(me.divisi_id)] : [];
        localStorage.setItem(Keys.USER_DIVISI, JSON.stringify(divList));
      }

      const roleLabel = role==='admin'?'Admin':role==='asisten'?'Asisten':'Mandor';
      const text = `Aktif: ${roleLabel} — ${localStorage.getItem(Keys.NAME)} (${nik})`;
      const elRole = document.getElementById('role-badge'); if (elRole) elRole.textContent = text;
      const elUser = document.getElementById('user-badge'); if (elUser) elUser.textContent = localStorage.getItem(Keys.NAME) || nik;

      ensureAsistenSections();
      ensureBackupRestoreAccess();

      $('#set-pass').value='';
      showToast('Login sukses');
    }catch(e){
      showToast(e.message || 'Login gagal');
    }finally{
      spinner(false);
    }
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
      keys.forEach((k,i)=>{
        Progress.update(`Menyimpan ${k}…`);
        LStore.setArr(MAP[k], Array.isArray(data[k]) ? data[k] : []);
        Progress.tick(i+1, keys.length);
      });
      Progress.update('Selesai');
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
      const month = ''; const year = '';
      let rows = [];
      try{
        const res = await API.actualPull({ role, nik, month, year }); // divisi auto-terkirim via sessionAttach()
        if (!res.ok) throw new Error(res.error || 'fetch gagal');
        rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
      }catch(errFetch){
        if (!hasJSONPFallback()) throw errFetch;
        const r = await gasJSONP('actual.pull', {
          role, nik, month, year,
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
      LStore.setArr(Keys.INPUT_RECORDS, merged);

      const q = new Set(LStore.getArr(Keys.SYNC_QUEUE)||[]);
      normalized.forEach(x=> q.delete(x.local_id));
      LStore.setArr(Keys.SYNC_QUEUE, [...q]);

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
    const ok = await confirmDialog('Yakin hapus SEMUA data lokal? Tindakan ini memerlukan password aktif.');
    if (!ok) return;
    const pass  = prompt('Masukkan password aktif untuk konfirmasi:');
    const token = localStorage.getItem(Keys.TOKEN) || '';
    if (!pass || hashPlain(pass) !== token){ showToast('Password salah'); return; }
    LStore.clearAll(); showToast('Data lokal dihapus'); location.reload();
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
      Progress.switchToDeterminate(parts.length+1);
      parts.forEach((k,i)=>{ Progress.update(`Menyimpan ${k}…`); applyMasterJSON({[k]:parsed[k]}); Progress.tick(i+1, parts.length+1); });

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
  document.getElementById('btn-export-xlsx').addEventListener('click', ()=>{
    try{
      Progress.open({ title:'Backup', subtitle:'Menyiapkan file .xlsx…' });
      exportLocalAsXLSX();
    }catch(e){
      showToast(e.message || 'Gagal membuat backup');
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
