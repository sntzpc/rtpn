/** ==========================================================
 *  FORM PUSINGAN PANEN — GAS BACKEND (AUTO-SETUP + USER MGMT)
 *  Endpoint: Web App doGet
 *  Response: JSON (ok, data?, error?)
 *  Versi: 1.1 (2025-09-15)
 *  ==========================================================
 */

// ==== Konfigurasi Spreadsheet ====
// Jika skrip terpasang langsung di Spreadsheet target, biarkan getActive().
// Jika tidak, isi openById('SPREADSHEET_ID').
const SS = SpreadsheetApp.getActive();

// ==== Nama Sheet & Header ====
const SHEET = {
  USERS: 'users',
  PUSINGAN: 'pusingan',

  MASTER_COMPANY: 'master_company',
  MASTER_ESTATE:  'master_estate',
  MASTER_DIVISI:  'master_divisi',
  MASTER_KADVEL:  'master_kadvel',
  MASTER_BLOK:    'master_blok',
  MASTER_MANDOR:  'master_mandor',
  MASTER_ASISTEN: 'master_asisten',
  MASTER_LIBUR:   'master_libur',
  ADVISOR_SCOPE: 'advisor_scope',
};

const HEAD = {
  [SHEET.USERS]:     ['nik','name','role','pass_hash','status'],
  [SHEET.PUSINGAN]:  ['tanggal','divisi_id','blok_id','kadvel_id','luas_panen_ha','jjg','brondolan_kg','hk','tonase_ton','nik_mandor','nama_mandor','server_key','server_id','created_at','updated_at'],

  [SHEET.MASTER_COMPANY]: ['id','nama'],
  [SHEET.MASTER_ESTATE]:  ['id','nama','company_id'],
  [SHEET.MASTER_DIVISI]:  ['id','kode','nama','estate_id'],
  [SHEET.MASTER_KADVEL]:  ['id','nama','divisi_id'],
  [SHEET.MASTER_BLOK]: ['id','kode','nama','divisi_id','kadvel_id','luas_ha','mandor_nik','bjr_kg_per_jjg'],
  [SHEET.MASTER_MANDOR]:  ['nik','nama','divisi_id'],
  [SHEET.MASTER_ASISTEN]: ['nik','nama','divisi_id'],
  [SHEET.MASTER_LIBUR]: ['tanggal', 'keterangan'],
  [SHEET.ADVISOR_SCOPE]: ['nik','estate_ids'], // "E01,E02"
};

// ===== JSON / JSONP Helpers (anti-CORS) =====
var CB = null; // di-set di doGet()

function _out(obj){
  var text = JSON.stringify(obj);
  if (CB) {
    // sanitize nama callback utk keamanan
    var cb = String(CB).replace(/[^\w$.]/g, '');
    return ContentService.createTextOutput(cb + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(data){ return _out({ ok:true, data:data }); }
function err(msg){ return _out({ ok:false, error:String(msg) }); }


// ===== Sheet Utils =====
function getOrCreateSheet(name){
  let sh = SS.getSheetByName(name);
  if (!sh){ sh = SS.insertSheet(name); }
  // pastikan header
  const needHeader = (() => {
    const lastCol = sh.getLastColumn();
    if (lastCol === 0) return true;
    const headRow = sh.getRange(1,1,1,HEAD[name].length).getValues()[0];
    return !HEAD[name].every((h,i)=> String(headRow[i]||'')===h);
  })();
  if (needHeader){
    sh.getRange(1,1,1,HEAD[name].length).setValues([HEAD[name]]);
  }
  return sh;
}

// ===== AUTH GUARD (nik + token/pass_hash dari FE) =====
function assertAuth(p, allowedRoles){
  const nik   = String(p.nik_auth||'').trim();
  const token = String(p.token||'').trim();         // pass_hash tersimpan di FE
  if (!nik || !token) throw new Error('AUTH_REQUIRED');

  ensureSetup();
  const users = readAllAsObjects(SHEET.USERS);
  const u = users.find(x =>
    String(x.nik)===nik &&
    String(x.pass_hash)===token &&
    String(x.status||'active').toLowerCase()!=='disabled'
  );
  if (!u) throw new Error('AUTH_INVALID');

  const role = String(u.role||'').toLowerCase();
  if (Array.isArray(allowedRoles) && allowedRoles.length && !allowedRoles.includes(role)){
    throw new Error('FORBIDDEN'); // role tidak diizinkan untuk endpoint ini
  }
  return u; // {nik,name,role,...}
}


// ====== Helper: divisi yang dipegang Asisten (berdasarkan sheet master_asisten) ======
function _asistenDivisiSet(nik){
  const rows = readAllAsObjects(SHEET.MASTER_ASISTEN);
  const ids = rows.filter(a => String(a.nik)===String(nik))
                  .map(a => String(a.divisi_id))
                  .filter(Boolean);
  return new Set(ids);
}

function _advisorEstateSet(nik){
  const rows = readAllAsObjects(SHEET.ADVISOR_SCOPE);
  const row  = rows.find(r => String(r.nik) === String(nik));
  const raw  = row ? String(row.estate_ids||'').trim() : '';
  const ids  = raw ? raw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  return new Set(ids);
}

function readAllAsObjects(sheetName){
  const sh = getOrCreateSheet(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = Math.max(sh.getLastColumn(), HEAD[sheetName].length);
  const values = sh.getRange(1,1,lastRow,lastCol).getValues();
  const head = values[0];
  return values.slice(1).map(r => {
    const o = {};
    head.forEach((h,i)=> o[h] = r[i]);
    return o;
  }).filter(o => Object.values(o).some(v => v!=='' && v!=null));
}

function writeAllReplace(sheetName, rowsArrOfObj){
  const sh = getOrCreateSheet(sheetName);
  sh.clearContents();
  const head = HEAD[sheetName];
  sh.getRange(1,1,1,head.length).setValues([head]);
  if (!rowsArrOfObj || rowsArrOfObj.length===0) return;
  const body = rowsArrOfObj.map(o => head.map(h => o[h] ?? ''));
  sh.getRange(2,1,body.length,head.length).setValues(body);
}

// Upsert sekumpulan baris berdasarkan kolom kunci (tanpa menghapus baris lain)
function upsertManyByKey(sheetName, keyCol, rowsArrOfObj){
  const sh = getOrCreateSheet(sheetName);
  const head = HEAD[sheetName];
  const keyIdx = head.indexOf(keyCol);
  if (keyIdx < 0) throw new Error(`Key ${keyCol} not found in ${sheetName}`);

  // peta key → row number
  const lastRow = sh.getLastRow();
  const keyToRow = {};
  if (lastRow >= 2){
    const colVals = sh.getRange(2, keyIdx+1, lastRow-1, 1).getValues();
    for (let i=0;i<colVals.length;i++){
      const k = String(colVals[i][0] || '').trim();
      if (k) keyToRow[k] = i + 2;
    }
  }

  let inserted = 0, updated = 0, skipped = 0;
  (rowsArrOfObj||[]).forEach(obj=>{
    const raw = obj[keyCol];
    const key = String(raw==null? '' : raw).trim();
    if (!key){ skipped++; return; }

    const rowVals = head.map(h => obj[h] ?? '');
    const rowNo = keyToRow[key];
    if (rowNo){
      sh.getRange(rowNo, 1, 1, head.length).setValues([rowVals]);
      updated++;
    }else{
      sh.appendRow(rowVals);
      keyToRow[key] = sh.getLastRow();
      inserted++;
    }
  });

  return { inserted, updated, skipped };
}


function appendOrUpdateByKey(sheetName, keyCol, rowObj){
  const sh = getOrCreateSheet(sheetName);
  const head = HEAD[sheetName];
  const keyIdx = head.indexOf(keyCol);
  if (keyIdx < 0) throw new Error(`Key ${keyCol} not found in ${sheetName}`);
  const lastRow = sh.getLastRow();
  if (lastRow >= 2){
    const vals = sh.getRange(2, keyIdx+1, lastRow-1, 1).getValues();
    for (let i=0;i<vals.length;i++){
      if (String(vals[i][0]) === String(rowObj[keyCol])){
        const row = i+2;
        const data = head.map(h => rowObj[h] ?? '');
        sh.getRange(row,1,1,head.length).setValues([data]);
        return {updated:true,row};
      }
    }
  }
  const data = HEAD[sheetName].map(h => rowObj[h] ?? '');
  sh.appendRow(data);
  return {updated:false,row:sh.getLastRow()};
}

function findRowByValue(sheetName, colName, value){
  const sh = getOrCreateSheet(sheetName);
  const head = HEAD[sheetName];
  const colIdx = head.indexOf(colName);
  if (colIdx < 0) throw new Error(`Column ${colName} not found in ${sheetName}`);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  const col = sh.getRange(2,colIdx+1,lastRow-1,1).getValues();
  for (let i=0;i<col.length;i++){
    if (String(col[i][0]) === String(value)) return i+2;
  }
  return 0;
}

// ===== FNV-1a (match FE) =====
function fnv1a(str){
  let h = 0x811c9dc5;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = (h + (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24)) >>> 0;
  }
  return ('0000000'+h.toString(16)).slice(-8);
}
function serverKeyFromRecord(rec){
  return fnv1a(String(rec.nik_mandor||'')+'|'+String(rec.tanggal||'')+'|'+String(rec.blok_id||''));
}

// ===== AUTO-SETUP =====
function ensureSetup(){
  // buat semua sheet + header
  Object.keys(HEAD).forEach(name => getOrCreateSheet(name));
  ensureSeedUsers();
}

function ensureSeedUsers(){
  const sh = getOrCreateSheet(SHEET.USERS);
  const users = readAllAsObjects(SHEET.USERS);
  if (users.length === 0){
    // Hash demo untuk 'user123' dari FE: 1971415050
    const seed = [
      { nik:'111', name:'Pak Budi', role:'mandor',  pass_hash:'1971415050', status:'active' },
      { nik:'222', name:'Bu Sari',  role:'asisten', pass_hash:'1971415050', status:'active' },
      { nik:'900', name:'Admin',    role:'admin',   pass_hash:'1971415050', status:'active' }, // NEW
    ];
    writeAllReplace(SHEET.USERS, seed);
  }
}


// ===== AUTH =====
function api_auth_login(p){
  const nik  = p.nik || '';
  const hash = p.pass_hash || '';
  const role = (p.role||'').toLowerCase();
  if (!nik || !hash || !role) return err('INVALID_PARAMS');

  ensureSetup();

  const users = readAllAsObjects(SHEET.USERS);
  const u = users.find(x => String(x.nik)===String(nik));
  if (!u) return err('USER_NOT_FOUND');
  if (String(u.pass_hash)!==String(hash)) return err('BAD_PASSWORD');
  if (String(u.status).toLowerCase()==='disabled') return err('USER_DISABLED');
  // role mismatch: masih lolos tapi beri info
  return ok({ nik:u.nik, name:u.name, role:u.role, role_mismatch: (String(u.role).toLowerCase()!==role) });
}

// ===== USER MGMT =====
function api_user_add(p){
  assertAuth(p, ['admin']);

  const nik  = (p.nik||'').trim(); if (!nik) return err('NIK_REQUIRED');
  const name = (p.name||'').trim() || nik;
  const role = (p.role||'').toLowerCase();

  // ✅ tambah advisor
  if (!['mandor','asisten','admin','advisor'].includes(role)) return err('ROLE_INVALID');

  const pass_hash = (p.pass_hash||'1971415050');
  const status = (p.status||'active');

  ensureSetup();
  appendOrUpdateByKey(SHEET.USERS, 'nik', { nik, name, role, pass_hash, status });

  // ✅ kalau advisor, simpan scope
  if (role === 'advisor'){
    const estate_ids = String(p.advisor_estate_ids||'').trim(); // "E01,E02"
    appendOrUpdateByKey(SHEET.ADVISOR_SCOPE, 'nik', { nik, estate_ids });
  } else {
    // kalau role bukan advisor, boleh bersihkan scope (opsional)
    const r = findRowByValue(SHEET.ADVISOR_SCOPE, 'nik', nik);
    if (r){
      const sh = getOrCreateSheet(SHEET.ADVISOR_SCOPE);
      sh.deleteRow(r);
    }
  }

  return ok({ upsert:true, nik });
}


function api_user_reset(p){
    assertAuth(p, ['admin']); 
  const nik = (p.nik||'').trim(); if (!nik) return err('NIK_REQUIRED');
  const pass_hash = (p.pass_hash||'1971415050'); // default reset ke user123
  ensureSetup();
  const users = readAllAsObjects(SHEET.USERS);
  const u = users.find(x => String(x.nik)===String(nik));
  const name = u ? u.name : nik;
  const role = u ? u.role : 'mandor';
  const status = u ? (u.status||'active') : 'active';
  appendOrUpdateByKey(SHEET.USERS, 'nik', { nik, name, role, pass_hash, status });
  return ok({ reset:true, nik });
}

function api_user_delete(p){
    assertAuth(p, ['admin']); 
  const nik = (p.nik||'').trim(); if (!nik) return err('NIK_REQUIRED');
  ensureSetup();
  const row = findRowByValue(SHEET.USERS, 'nik', nik);
  if (!row) return err('USER_NOT_FOUND');
  const sh = getOrCreateSheet(SHEET.USERS);
  sh.deleteRow(row);
  return ok({ deleted:true, nik });
}


// ===== USER MGMT =====
function api_user_list(p){
  assertAuth(p, ['admin']);
  ensureSetup();

  const users = readAllAsObjects(SHEET.USERS);
  const scopes = readAllAsObjects(SHEET.ADVISOR_SCOPE);
  const mapScope = {};
  scopes.forEach(s => mapScope[String(s.nik)] = String(s.estate_ids||''));

  const merged = users.map(u => ({
    ...u,
    advisor_estate_ids: mapScope[String(u.nik)] || ''
  }));

  return ok({ users: merged });
}


// ===== MASTER PULL =====
function api_master_pull(p){
  ensureSetup();

  // Ambil identitas yang SUDAH diverifikasi
  const u    = assertAuth(p, ['admin','asisten','mandor','advisor']);
  const role = String(u.role||'').toLowerCase();
  const nik  = String(u.nik||'');

  const company = readAllAsObjects(SHEET.MASTER_COMPANY);
  const estate  = readAllAsObjects(SHEET.MASTER_ESTATE);
  const divisi  = readAllAsObjects(SHEET.MASTER_DIVISI);
  const kadvel  = readAllAsObjects(SHEET.MASTER_KADVEL);
  const blok    = readAllAsObjects(SHEET.MASTER_BLOK);
  const mandor  = readAllAsObjects(SHEET.MASTER_MANDOR);
  const asisten = readAllAsObjects(SHEET.MASTER_ASISTEN);
  const libur   = readAllAsObjects(SHEET.MASTER_LIBUR).map(x => ({
    tanggal: (x.tanggal instanceof Date)
      ? Utilities.formatDate(x.tanggal, 'Asia/Jakarta', 'yyyy-MM-dd')
      : String(x.tanggal||''),
    keterangan: x.keterangan || ''
  }));

  // ==== ADMIN: full akses ====
  if (role==='admin'){
    return ok({ company, estate, divisi, kadvel, blok, mandor, asisten, libur });
  }

  // ✅ ADVISOR: seperti admin tapi estate dibatasi
  if (role==='advisor'){
    const allowedEstate = _advisorEstateSet(nik);
    if (!allowedEstate.size){
      return ok({ company:[], estate:[], divisi:[], kadvel:[], blok:[], mandor:[], asisten:[], libur });
    }
    const estFiltered = estate.filter(e => allowedEstate.has(String(e.id)));
    const divFiltered = divisi.filter(d => allowedEstate.has(String(d.estate_id)));
    const divSet = new Set(divFiltered.map(d=>String(d.id)));
    const kadFiltered  = kadvel.filter(k => divSet.has(String(k.divisi_id)));
    const blokFiltered = blok.filter(b => divSet.has(String(b.divisi_id)));
    const mandFiltered = mandor.filter(m => divSet.has(String(m.divisi_id)));
    const asisFiltered = asisten.filter(a => divSet.has(String(a.divisi_id)));

    const compIdSet = new Set(estFiltered.map(e=>String(e.company_id)));
    const compFiltered = company.filter(c => compIdSet.has(String(c.id)));

    return ok({
      company: compFiltered,
      estate : estFiltered,
      divisi : divFiltered,
      kadvel : kadFiltered,
      blok   : blokFiltered,
      mandor : mandFiltered,
      asisten: asisFiltered,
      libur
    });
  }

  // ==== ASISTEN: batasi hanya divisi yang dipegang ====
  if (role==='asisten'){
    const allowed = _asistenDivisiSet(nik); // Set<string> divisi_id
    if (!allowed.size){
      // Tidak ada mapping → kosongkan (atau kembalikan libur saja)
      return ok({
        company:[], estate:[], divisi:[], kadvel:[], blok:[], mandor:[],
        asisten: asisten.filter(a=>String(a.nik)===String(nik)),
        libur
      });
    }

    const divFiltered   = divisi.filter(d => allowed.has(String(d.id)));
    const estateIdSet   = new Set(divFiltered.map(d => String(d.estate_id)));
    const estFiltered   = estate.filter(e => estateIdSet.has(String(e.id)));
    const compIdSet     = new Set(estFiltered.map(e => String(e.company_id)));
    const compFiltered  = company.filter(c => compIdSet.has(String(c.id)));
    const kadFiltered   = kadvel.filter(k => allowed.has(String(k.divisi_id)));
    const blokFiltered  = blok.filter(b => allowed.has(String(b.divisi_id)));
    const mandFiltered  = mandor.filter(m => allowed.has(String(m.divisi_id)));
    const asisFiltered  = asisten.filter(a => allowed.has(String(a.divisi_id)));

    return ok({
      company: compFiltered,
      estate : estFiltered,
      divisi : divFiltered,
      kadvel : kadFiltered,
      blok   : blokFiltered,
      mandor : mandFiltered,
      asisten: asisFiltered,
      libur
    });
  }

  // ==== MANDOR: batasi ke miliknya ====
  const blokMandor   = blok.filter(b => String(b.mandor_nik)===String(nik));
  const divisiIdSet  = new Set(blokMandor.map(b => String(b.divisi_id)));
  const divMandor    = divisi.filter(d => divisiIdSet.has(String(d.id)));
  const estateIdSet  = new Set(divMandor.map(d => String(d.estate_id)));
  const estateMandor = estate.filter(e => estateIdSet.has(String(e.id)));
  const compIdSet    = new Set(estateMandor.map(e => String(e.company_id)));
  const companyMandor= company.filter(c => compIdSet.has(String(c.id)));
  const kadvelMandor = kadvel.filter(k => divisiIdSet.has(String(k.divisi_id)));
  const mandorSelf   = mandor.filter(m => String(m.nik)===String(nik));
  const asistenRel   = asisten.filter(a => divisiIdSet.has(String(a.divisi_id)));

  return ok({
    company: companyMandor,
    estate:  estateMandor,
    divisi:  divMandor,
    kadvel:  kadvelMandor,
    blok:    blokMandor,
    mandor:  mandorSelf,
    asisten: asistenRel,
    libur
  });
}


function api_master_push(p){
    assertAuth(p, ['admin','asisten']); 
  ensureSetup();
  const payload = p.payload; if (!payload) return err('MISSING_PAYLOAD');
  let obj; try{ obj = JSON.parse(payload); }catch(e){ return err('BAD_JSON'); }

  // normalisasi libur → yyyy-MM-dd
  function toISODate(v){
    if (v instanceof Date) {
      return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
    }
    if (typeof v === 'number' && !isNaN(v)) {
      var ms = Math.round((v - 25569) * 86400 * 1000); // excel serial → JS date
      return Utilities.formatDate(new Date(ms), 'Asia/Jakarta', 'yyyy-MM-dd');
    }
    var s = String(v || '').trim();
    return s;
  }

  // Peta kolom kunci unik per sheet master
  const KEYMAP = {};
  KEYMAP[SHEET.MASTER_COMPANY] = 'id';
  KEYMAP[SHEET.MASTER_ESTATE]  = 'id';
  KEYMAP[SHEET.MASTER_DIVISI]  = 'id';
  KEYMAP[SHEET.MASTER_KADVEL]  = 'id';
  KEYMAP[SHEET.MASTER_BLOK]    = 'id';
  KEYMAP[SHEET.MASTER_MANDOR]  = 'nik';
  KEYMAP[SHEET.MASTER_ASISTEN] = 'nik';
  KEYMAP[SHEET.MASTER_LIBUR]   = 'tanggal'; // unik per tanggal

  const lock = LockService.getScriptLock(); lock.waitLock(30*1000);
  const result = {};
  try{
    if (obj.company && obj.company.length){
      result.company = upsertManyByKey(SHEET.MASTER_COMPANY, KEYMAP[SHEET.MASTER_COMPANY], obj.company);
    }
    if (obj.estate && obj.estate.length){
      result.estate  = upsertManyByKey(SHEET.MASTER_ESTATE,  KEYMAP[SHEET.MASTER_ESTATE],  obj.estate);
    }
    if (obj.divisi && obj.divisi.length){
      result.divisi  = upsertManyByKey(SHEET.MASTER_DIVISI,  KEYMAP[SHEET.MASTER_DIVISI],  obj.divisi);
    }
    if (obj.kadvel && obj.kadvel.length){
      result.kadvel  = upsertManyByKey(SHEET.MASTER_KADVEL,  KEYMAP[SHEET.MASTER_KADVEL],  obj.kadvel);
    }
    if (obj.blok && obj.blok.length){
      result.blok    = upsertManyByKey(SHEET.MASTER_BLOK,    KEYMAP[SHEET.MASTER_BLOK],    obj.blok);
    }
    if (obj.mandor && obj.mandor.length){
      result.mandor  = upsertManyByKey(SHEET.MASTER_MANDOR,  KEYMAP[SHEET.MASTER_MANDOR],  obj.mandor);
    }
    if (obj.asisten && obj.asisten.length){
      result.asisten = upsertManyByKey(SHEET.MASTER_ASISTEN, KEYMAP[SHEET.MASTER_ASISTEN], obj.asisten);
    }
    if (obj.libur && obj.libur.length){
      const rows = obj.libur.map(x => ({
        tanggal: toISODate(x.tanggal),
        keterangan: x.keterangan || ''
      }));
      result.libur   = upsertManyByKey(SHEET.MASTER_LIBUR,   KEYMAP[SHEET.MASTER_LIBUR],   rows);
    }
  } finally { lock.releaseLock(); }

  // catatan: jika sebuah bagian kosong / tidak ada → tidak menyentuh sheet
  return ok({ upserted: result });
}


// ===== ACTUAL PULL (download data aktual dari sheet PUSINGAN) =====
function api_actual_pull(p){
  ensureSetup();

  // ✅ tambah advisor
  const u    = assertAuth(p, ['admin','asisten','mandor','advisor']);
  const role = String(u.role||'').toLowerCase();
  const nik  = String(u.nik||'');

  // parameter filter (opsional)
  const year = String(p.year || '').trim(); // "2025"
  const estateIdsRaw = String(p.estate_ids || '').trim(); // "E01,E02" atau "" untuk all
  const estateSetReq = estateIdsRaw ? new Set(estateIdsRaw.split(',').map(s=>s.trim()).filter(Boolean)) : null;

  // map divisi_id -> estate_id
  const divMaster = readAllAsObjects(SHEET.MASTER_DIVISI);
  const divToEstate = {};
  divMaster.forEach(d => divToEstate[String(d.id)] = String(d.estate_id||''));

  // whitelist role
  const allowDiv = (role==='asisten') ? _asistenDivisiSet(nik) : null;
  const allowEstateAdvisor = (role==='advisor') ? _advisorEstateSet(nik) : null;

  const rows = readAllAsObjects(SHEET.PUSINGAN);

  function normDate(v){
    if (v instanceof Date){
      return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
    }
    return String(v||'').trim();
  }

  const out = [];
  for (let i=0; i<rows.length; i++){
    const r = rows[i]; if (!r) continue;

    const tgl = normDate(r.tanggal || '');
    const divId = String(r.divisi_id||'');
    const estId = divToEstate[divId] || '';

    // filter role
    if (role === 'mandor' && String(r.nik_mandor||'') !== nik) continue;

    if (role === 'asisten'){
      if (allowDiv && allowDiv.size && !allowDiv.has(divId)) continue;
    }

    if (role === 'advisor'){
      if (!allowEstateAdvisor || !allowEstateAdvisor.size) continue;
      if (!allowEstateAdvisor.has(estId)) continue;
    }

    // filter tahun
    if (year && !String(tgl).startsWith(year + '-')) continue;

    // filter estate_ids dari FE (jika dipilih)
    if (estateSetReq && estateSetReq.size && !estateSetReq.has(estId)) continue;

    const obj = {};
    HEAD[SHEET.PUSINGAN].forEach(h => obj[h] = r[h] ?? '');
    obj.tanggal       = tgl;
    obj.luas_panen_ha = Number(obj.luas_panen_ha || 0);
    obj.jjg           = Number(obj.jjg || 0);
    obj.brondolan_kg  = Number(obj.brondolan_kg || 0);
    obj.hk            = Number(obj.hk || 0);
    obj.tonase_ton    = Number(obj.tonase_ton || 0);

    out.push(obj);
  }

  return ok({ rows: out });
}

// ===== Guard tulis Pusingan (baru) =====
function _pusinganExistsByKey(key){
  const row = findRowByValue(SHEET.PUSINGAN, 'server_key', key);
  return row > 0;
}

function assertMayWritePusingan(user, rec, mode){ // mode: 'insert' | 'update'
  var role = String(user.role||'').toLowerCase();
  if (role === 'admin') return; // full access

  if (role === 'mandor'){
    if (mode === 'update') throw new Error('FORBIDDEN_MANDOR_NO_UPDATE'); // mandor dilarang update
    if (String(rec.nik_mandor||'') !== String(user.nik||'')) {
      throw new Error('FORBIDDEN_MANDOR_NOT_OWNER'); // insert hanya miliknya
    }
    return;
  }

  if (role === 'asisten'){
    var allow = _asistenDivisiSet(user.nik); // Set divisi_id
    if (allow && allow.size && !allow.has(String(rec.divisi_id||''))) {
      throw new Error('FORBIDDEN_ASISTEN_OUT_OF_SCOPE');
    }
    return;
  }

  throw new Error('FORBIDDEN_ROLE');
}

// ===== PUSINGAN CHECK / INSERT / UPDATE =====
function api_pusingan_check(p){
  ensureSetup();
  var u = assertAuth(p, ['admin','asisten','mandor','advisor']); // pastikan request terautentikasi
  const key = p.key||''; if (!key) return err('MISSING_KEY');
  const row = findRowByValue(SHEET.PUSINGAN, 'server_key', key);
  if (!row) return ok({ exists:false });
  const sh = getOrCreateSheet(SHEET.PUSINGAN);
  const head = HEAD[SHEET.PUSINGAN];
  const vals = sh.getRange(row,1,1,head.length).getValues()[0];
  const obj = {}; head.forEach((h,i)=> obj[h]=vals[i]);
  return ok({ exists:true, row, server_id: obj.server_id||'' });
}

function api_pusingan_insert(p){
  ensureSetup();
  var u = assertAuth(p, ['admin','asisten','mandor','advisor']);
  const payload = p.payload; if (!payload) return err('MISSING_PAYLOAD');
  let rec; try{ rec = JSON.parse(payload); }catch(e){ return err('BAD_JSON'); }

  // Izin: mandor hanya insert miliknya; asisten sesuai divisi
  assertMayWritePusingan(u, rec, 'insert');

  const now = new Date().toISOString();
  const key = serverKeyFromRecord(rec);
  const found = findRowByValue(SHEET.PUSINGAN, 'server_key', key);
  if (found){
    const sh = getOrCreateSheet(SHEET.PUSINGAN);
    const head = HEAD[SHEET.PUSINGAN];
    const vals = sh.getRange(found,1,1,head.length).getValues()[0];
    const obj = {}; head.forEach((h,i)=> obj[h]=vals[i]);
    return ok({ already_exists:true, server_id: obj.server_id||'', server_key:key });
  }

  const rowObj = {};
  HEAD[SHEET.PUSINGAN].forEach(h => rowObj[h] = rec[h] ?? '');
  rowObj.server_key = key;
  rowObj.server_id  = Utilities.getUuid();
  rowObj.created_at = rec.created_at || now;
  rowObj.updated_at = now;

  const lock = LockService.getScriptLock(); lock.waitLock(30*1000);
  try{ appendOrUpdateByKey(SHEET.PUSINGAN,'server_id',rowObj); }
  finally{ lock.releaseLock(); }

  return ok({ server_id: rowObj.server_id, server_key: key });
}

function api_pusingan_update(p){
  ensureSetup();
  var u = assertAuth(p, ['admin','asisten','mandor', 'advisor']); // mandor akan ditolak oleh assertMayWritePusingan
  const key = p.key||''; if (!key) return err('MISSING_KEY');
  const payload = p.payload; if (!payload) return err('MISSING_PAYLOAD');
  let rec; try{ rec = JSON.parse(payload); }catch(e){ return err('BAD_JSON'); }

  // Izin: mandor TIDAK boleh update; asisten boleh sesuai divisi
  assertMayWritePusingan(u, rec, 'update');

  const row = findRowByValue(SHEET.PUSINGAN, 'server_key', key);
  const now = new Date().toISOString();

  const rowObj = {};
  HEAD[SHEET.PUSINGAN].forEach(h => rowObj[h] = rec[h] ?? '');
  rowObj.server_key = key;

  const lock = LockService.getScriptLock(); lock.waitLock(30*1000);
  try{
    if (row){
      const sh = getOrCreateSheet(SHEET.PUSINGAN);
      const head = HEAD[SHEET.PUSINGAN];
      const old = sh.getRange(row,1,1,head.length).getValues()[0];
      const oldObj = {}; head.forEach((h,i)=> oldObj[h]=old[i]);
      rowObj.server_id  = oldObj.server_id || Utilities.getUuid();
      rowObj.created_at = oldObj.created_at || rec.created_at || now;
      rowObj.updated_at = now;
      const vals = head.map(h => rowObj[h] ?? '');
      sh.getRange(row,1,1,head.length).setValues([vals]);
      return ok({ server_id: rowObj.server_id, server_key:key, updated:true });
    } else {
      // Tidak ditemukan → buat baru (tetap izinkan utk asisten/admin; mandor sudah ditolak di atas bila mode 'update')
      rowObj.server_id  = Utilities.getUuid();
      rowObj.created_at = rec.created_at || now;
      rowObj.updated_at = now;
      appendOrUpdateByKey(SHEET.PUSINGAN,'server_id',rowObj);
      return ok({ server_id: rowObj.server_id, server_key:key, inserted:true });
    }
  } finally { lock.releaseLock(); }
}


// ===== SYNC BULK (offline → online, banyak record sekaligus) =====
// payload: JSON array of records. Mengembalikan rincian per-record:
//   { ok:true, data:{ total, success, failed, results:[{local_id, ok, action?, error?}] } }
function api_sync_bulk(p){
  ensureSetup();
  const u = assertAuth(p, ['admin','asisten','mandor','advisor']);

  const payload = p.payload; if (!payload) return err('MISSING_PAYLOAD');
  let records; try{ records = JSON.parse(payload); }catch(e){ return err('BAD_JSON'); }
  if (!Array.isArray(records)) return err('BAD_PAYLOAD_NOT_ARRAY');

  const now = new Date().toISOString();
  const results = [];
  let success = 0, failed = 0;

  const lock = LockService.getScriptLock();
  lock.waitLock(30*1000);
  try{
    for (let i=0; i<records.length; i++){
      const rec = records[i] || {};
      const lid = rec.local_id || '';
      try{
        // Izin per-record (mandor: hanya miliknya & tidak boleh update; asisten: sesuai divisi)
        const key = rec.server_key && String(rec.server_key).trim()
          ? String(rec.server_key).trim()
          : serverKeyFromRecord(rec);
        const found = findRowByValue(SHEET.PUSINGAN, 'server_key', key);

        const mode = found ? 'update' : 'insert';
        assertMayWritePusingan(u, rec, mode);

        const rowObj = {};
        HEAD[SHEET.PUSINGAN].forEach(h => rowObj[h] = rec[h] ?? '');
        rowObj.server_key = key;

        if (found){
          const sh = getOrCreateSheet(SHEET.PUSINGAN);
          const head = HEAD[SHEET.PUSINGAN];
          const old = sh.getRange(found,1,1,head.length).getValues()[0];
          const oldObj = {}; head.forEach((h,j)=> oldObj[h]=old[j]);
          rowObj.server_id  = oldObj.server_id || Utilities.getUuid();
          rowObj.created_at = oldObj.created_at || rec.created_at || now;
          rowObj.updated_at = now;
          const vals = head.map(h => rowObj[h] ?? '');
          sh.getRange(found,1,1,head.length).setValues([vals]);
          results.push({ local_id: lid, ok:true, action:'update', server_key:key, server_id:rowObj.server_id });
        }else{
          rowObj.server_id  = Utilities.getUuid();
          rowObj.created_at = rec.created_at || now;
          rowObj.updated_at = now;
          appendOrUpdateByKey(SHEET.PUSINGAN,'server_id',rowObj);
          results.push({ local_id: lid, ok:true, action:'insert', server_key:key, server_id:rowObj.server_id });
        }
        success++;
      }catch(e){
        failed++;
        results.push({ local_id: lid, ok:false, error: (e && e.message) ? e.message : String(e) });
      }
    }
  } finally {
    lock.releaseLock();
  }

  return ok({ total: records.length, success, failed, results });
}


// ===== Router =====
function _dispatch(p){
  switch (p.route || ''){
    case 'auth.login':        return api_auth_login(p);
    case 'user.add':          return api_user_add(p);
    case 'user.reset':        return api_user_reset(p);
    case 'user.list':         return api_user_list(p);
    case 'master.pull':       return api_master_pull(p);
    case 'master.push':       return api_master_push(p);
    case 'pusingan.check':    return api_pusingan_check(p);
    case 'pusingan.insert':   return api_pusingan_insert(p);
    case 'pusingan.update':   return api_pusingan_update(p);
    case 'sync.bulk':         return api_sync_bulk(p);
    case 'user.delete':       return api_user_delete(p);
    case 'actual.pull':       return api_actual_pull(p);
    case 'actual_pull':       return api_actual_pull(p); // alias
    default: return err('UNKNOWN_ROUTE');
  }
}

function doGet(e){
  try{
    const p = e && e.parameter ? e.parameter : {};
    // >>> dukung JSONP
    CB = p.callback || null;
    return _dispatch(p);
  }catch(ex){
    return err(ex && ex.message ? ex.message : ex);
  }
}

// doPost: dipakai untuk payload besar (mis. sync.bulk) tanpa batas panjang URL.
// FE mengirim body form-encoded (text/plain) sehingga tidak memicu CORS preflight.
function doPost(e){
  try{
    let p = (e && e.parameter) ? e.parameter : {};

    // Bila body berupa urlencoded di postData.contents (saat Content-Type text/plain),
    // GAS tidak otomatis mengisi e.parameter — parse manual.
    if ((!p || !p.route) && e && e.postData && e.postData.contents){
      const parsed = {};
      String(e.postData.contents).split('&').forEach(pair=>{
        if (!pair) return;
        const idx = pair.indexOf('=');
        const k = decodeURIComponent((idx>=0 ? pair.slice(0,idx) : pair).replace(/\+/g,' '));
        const v = idx>=0 ? decodeURIComponent(pair.slice(idx+1).replace(/\+/g,' ')) : '';
        parsed[k] = v;
      });
      // gabungkan: e.parameter (jika ada) menang utk key yang sudah terisi
      p = Object.assign(parsed, p);
    }

    CB = p.callback || null;
    return _dispatch(p);
  }catch(ex){
    return err(ex && ex.message ? ex.message : ex);
  }
}


// ===== Manual bootstrap (opsional dari editor) =====
function setup(){ ensureSetup(); }
