// =====================
// File: features/input.js
// =====================
import {
  $,
  fmtDateISO,
  nowISO,
  hash,
  ensureNumber
} from '../core/utils.js';
import {
  Keys,
  LStore
} from '../core/storage.js';
import {
  upsertRecord,
  SyncState,
  getRecord
} from '../core/sync.js';
import {
  Progress
} from '../core/progress.js';

/* ===== JSONP FALLBACK (mini, sama pola dgn settings.js) ===== */
function _gasBase() {
  const base = ((typeof window !== 'undefined' && window.GAS_BASE_URL) || localStorage.getItem('API_BASE') || '').replace(/\/$/, '');
  if (!base) throw new Error('JSONP base belum diset. Set window.GAS_BASE_URL atau localStorage "API_BASE".');
  if (/macros\/echo\b/.test(base)) console.error('URL GAS salah: gunakan /exec, bukan /macros/echo');
  return base;
}

function hasJSONPFallback() {
  return !!((typeof window !== 'undefined' && window.GAS_BASE_URL) || localStorage.getItem('API_BASE'));
}

function gasJSONP(route, params = {}) {
  const base = _gasBase();
  return new Promise((resolve, reject) => {
    const cb = '__jsonp_cb_' + Math.random().toString(36).slice(2);
    const qs = new URLSearchParams({
      ...params,
      route,
      callback: cb
    }).toString();
    const s = document.createElement('script');
    let done = false;

    function cleanup() {
      try {
        delete window[cb];
      } catch {}
      s.remove();
    }
    window[cb] = (resp) => {
      done = true;
      resolve(resp);
      cleanup();
    };
    s.onerror = () => {
      if (!done) {
        reject(new Error('JSONP error'));
        cleanup();
      }
    };
    s.src = `${base}?${qs}`;
    document.body.appendChild(s);
    setTimeout(() => {
      if (!done) {
        reject(new Error('JSONP timeout'));
        cleanup();
      }
    }, 20000);
  });
}

let SELECTED_BLOCK = null; // cache blok terpilih (obj master)

function getBJR(blok_id) {
  const bl = LStore.getArr(Keys.MASTER_BLOK) || [];
  const b = bl.find(x => String(x.id) === String(blok_id));
  return b ? ensureNumber(b.bjr_kg_per_jjg, 0) : 0;
}

function kadvelNameById(id) {
  const list = LStore.getArr(Keys.MASTER_KADVEL) || [];
  const k = list.find(x => String(x.id) === String(id));
  return k ? (k.nama || k.kode || k.id) : (id || '');
}


function compute(rec) {
  const bjr = getBJR(rec.blok_id);                     // kg/jjg
  const jjg = ensureNumber(rec.jjg, 0);
  const br  = ensureNumber(rec.brondolan_kg, 0);

  const ton = (jjg * bjr) / 1000;                      // kg -> ton
  const tonPerHK = rec.hk > 0 ? ton / rec.hk : 0;
  const tonPerHa = rec.luas_panen_ha > 0 ? ton / rec.luas_panen_ha : 0;

  const denomKg = jjg * bjr;                            // kg
  const lfPct   = denomKg > 0 ? (br / denomKg) * 100 : 0;

  return {
    bjr,
    tonase_ton: +ton.toFixed(2),
    tonPerHK:   +tonPerHK.toFixed(2),
    tonPerHa:   +tonPerHa.toFixed(2),
    lfPct:      +lfPct.toFixed(2)
  };
}


function setKPI(bjr, tonase_ton, tonPerHK, tonPerHa, lfPct = 0) {
  $('#k-bjr').textContent = Number(bjr || 0).toFixed(2);
  $('#k-ton').textContent = Number(tonase_ton || 0).toFixed(2);
  $('#k-thk').textContent = Number(tonPerHK || 0).toFixed(2);
  $('#k-tha').textContent = Number(tonPerHa || 0).toFixed(2);

  // %LF hanya tampil kalau field brondolan sudah diisi (tidak kosong)
  const brEl = $('#in-br');
  const brFilled = brEl && String(brEl.value).trim() !== '';
  $('#f-lf').textContent = brFilled ? Number(lfPct || 0).toFixed(2) : '';
}



// Reset form setelah simpan, kecuali tanggal
function resetFieldsAfterSave() {
  $('#in-blok').value = '';
  $('#in-divisi').value = '';
  $('#in-kadvel').value = '';
  $('#in-luas').value = '';
  $('#in-jjg').value = '';
  $('#in-br').value = '';
  $('#in-hk').value = '';
  $('#in-note').value = '';
  SELECTED_BLOCK = null;
  setKPI(0, 0, 0, 0, 0);
  // sembunyikan banner edit bila ada
  const banner = document.getElementById('edit-banner');
  if (banner) banner.style.display = 'none';
  // fokuskan kembali ke blok untuk input cepat
  $('#in-blok').focus();
}


function view() {
  return `
  <div class="card">
    <h2>Input Pusingan Panen</h2>
    <div id="edit-banner" class="badge" style="display:none;margin-bottom:8px;background:#1f2937">Mode Edit</div>

    <div class="row">
      <div class="col">
        <label>Tanggal</label>
        <input type="date" id="in-date" value="${fmtDateISO()}" />
      </div>
      <div class="col">
        <label>Blok</label>
        <input id="in-blok" list="list-blok" placeholder="Ketik blok" autocomplete="off" />
        <datalist id="list-blok"></datalist>
        <small id="blok-hint" class="muted"></small>
      </div>
      <div class="col">
        <label>Divisi</label>
        <input id="in-divisi" disabled />
      </div>
      <div class="col">
        <label>Kadvel</label>
        <input id="in-kadvel" disabled />
      </div>
    </div>

    <div class="row">
      <div class="col">
        <label>Luas Panen (Ha)</label>
        <input type="number" step="0.01" min="0" id="in-luas" />
      </div>
      <div class="col">
        <label>JJG</label>
        <input type="number" step="1" min="0" id="in-jjg" />
      </div>
      <div class="col">
        <label>Brondolan (kg)</label>
        <input type="number" step="0.1" min="0" id="in-br" />
      </div>
      <div class="col">
        <label>HK</label>
        <input type="number" step="0.1" min="0" id="in-hk" />
      </div>
    </div>

    <label>Catatan</label>
    <textarea id="in-note" rows="3" placeholder="opsional"></textarea>

    <div class="kpi">
      <div class="card"><b>BJR (kg/jjg)</b><div id="k-bjr" class="badge">0</div></div>
      <div class="card"><b>Tonase (ton)</b><div id="k-ton" class="badge">0</div></div>
      <div class="card"><b>%LF</b><div id="f-lf" class="badge">0</div></div>
      <div class="card"><b>Ton/HK</b><div id="k-thk" class="badge">0</div></div>
      <div class="card"><b>Ton/Ha</b><div id="k-tha" class="badge">0</div></div>
    </div>

    <div class="row">
      <div class="col"><button class="primary" id="btn-save">Simpan</button></div>
      <div class="col"><button id="btn-reset">Reset</button></div>
    </div>
    <div class="row" id="input-actions">
      <button id="btn-bulk-input" class="secondary">Upload Data (.xlsx)</button>
    </div>
  </div>`;
}

// ==== Auto-suggest blok ====
function getVisibleBlocks() {
  const role = localStorage.getItem(Keys.ROLE) || '-';
  const nik = localStorage.getItem(Keys.NIK) || '';
  let blok = LStore.getArr(Keys.MASTER_BLOK) || [];
  if (role === 'mandor' && nik) {
    blok = blok.filter(b => String(b.mandor_nik) === String(nik));
  }
  return blok;
}

// ==== Auto-suggest blok (label: "Nama Blok | xx,xx Ha") ====
function fillBlockDatalist() {
  const list = $('#list-blok');
  const blocks = getVisibleBlocks();
  const nf = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  list.innerHTML = blocks.map(b => {
    const name = b.nama || b.kode || b.id;
    const luas = Number(b.luas_ha || 0);
    const label = `${name} | ${nf.format(luas)} Ha`;
    return `<option value="${label}"></option>`;
  }).join('');

  // hint
  $('#blok-hint').textContent = 'Pilih dari saran.';
}


// resolve blok dari input "Nama | 16,97 Ha" atau ketikan sebagian nama/kode/id
function resolveBlock(text) {
  const raw = (text || '').trim();
  if (!raw) return null;

  const blocks = getVisibleBlocks();

  // Ekstrak bagian nama sebelum '|'
  const namePart = raw.split('|')[0].trim();
  const q = namePart.toLowerCase();

  // Coba exact match dulu
  const exact = blocks.find(b =>
    String(b.id).toLowerCase() === q ||
    String(b.kode || '').toLowerCase() === q ||
    String(b.nama || '').toLowerCase() === q
  );
  if (exact) return exact;

  // Kalau tidak ada exact, cari contains
  const cand = blocks.find(b =>
    String(b.id).toLowerCase().includes(q) ||
    String(b.kode || '').toLowerCase().includes(q) ||
    String(b.nama || '').toLowerCase().includes(q)
  );
  return cand || null;
}


function applyBlock(b) {
  SELECTED_BLOCK = b;
  if (!b) {
    $('#in-divisi').value = '';
    $('#in-kadvel').value = '';
    setKPI(0, 0, 0, 0, 0);
    return;
  }
  // auto set divisi & kadvel dari master blok
  $('#in-divisi').value = b.divisi_id || '';
  $('#in-kadvel').value = kadvelNameById(b.kadvel_id) || '';
  // recompute KPI (BJR ikut blok)
  const rec = collect(false);
  const { bjr, tonase_ton, lfPct, tonPerHK, tonPerHa } = compute(rec);
  setKPI(bjr, tonase_ton, tonPerHK, tonPerHa, lfPct );
}

function bindCompute() {
  const run = () => {
    const rec = collect(false);
    const { bjr, tonase_ton, lfPct, tonPerHK, tonPerHa } = compute(rec);
    setKPI(bjr, tonase_ton, tonPerHK, tonPerHa, lfPct);
  };
  ['#in-jjg', '#in-hk', '#in-luas', '#in-br'].forEach(sel => $(sel).addEventListener('input', run));
}

function mandorSession() {
  const nik = localStorage.getItem(Keys.NIK) || localStorage.getItem('pp2:session.nik') || 'MANDOR';
  const name = localStorage.getItem(Keys.NAME) || localStorage.getItem('pp2:session.name') || 'Mandor';
  return {
    nik,
    name
  };
}

function collect(assignIds = true) {
  const {
    nik,
    name
  } = mandorSession();
  const tanggal = $('#in-date').value || fmtDateISO();
  const blokText = $('#in-blok').value || '';
  // pastikan SELECTED_BLOCK sesuai teks terkini
  const chosen = SELECTED_BLOCK && blokText.includes(SELECTED_BLOCK.id) ? SELECTED_BLOCK : resolveBlock(blokText);
  const blok_id = chosen ? chosen.id : '';
  const divisi_id = chosen ? chosen.divisi_id || '' : '';
  const kadvel_id = chosen ? chosen.kadvel_id || '' : '';

  const luas_panen_ha = ensureNumber($('#in-luas').value, 0);
  const jjg = ensureNumber($('#in-jjg').value, 0);
  const brondolan_kg = ensureNumber($('#in-br').value, 0);
  const hk = ensureNumber($('#in-hk').value, 0);
  const catatan = ($('#in-note').value || '').trim();

  const local_id = hash(`${nik}|${tanggal}|${blok_id}`);
  const rec = {
    local_id,
    server_id: null,
    nik_mandor: nik,
    nama_mandor: name,
    divisi_id,
    blok_id,
    kadvel_id,
    tanggal,
    luas_panen_ha,
    jjg,
    brondolan_kg,
    hk,
    catatan,
    sync_status: 'pending',
    created_at: nowISO(),
    updated_at: nowISO()
  };
  const c = compute(rec);
  rec.tonase_ton = c.tonase_ton;
  if (!assignIds) {
    delete rec.created_at;
    delete rec.updated_at;
  }
  return rec;
}

function validate(rec) {
  if (!rec.tanggal) return 'Tanggal wajib diisi';
  if (!rec.blok_id) return 'Blok wajib dipilih dari saran';
  if (!rec.divisi_id) return 'Divisi tidak ditemukan dari blok';
  // kadvel opsional di UI, tapi idealnya ada di master
  return null;
}

function prefillIfEdit() {
  const editId = sessionStorage.getItem('edit.local_id');
  if (!editId) return null;
  const rec = getRecord(editId);
  if (!rec) {
    sessionStorage.removeItem('edit.local_id');
    return null;
  }
  $('#edit-banner').style.display = 'inline-block';
  $('#in-date').value = rec.tanggal || fmtDateISO();

  // isi kotak blok dengan label ramah
  const b = resolveBlock(rec.blok_id) || resolveBlock(rec.blok_id + '') || (getVisibleBlocks().find(x => String(x.id) === String(rec.blok_id)) || null);
  if (b) {
    const nf = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const name = b.nama || b.kode || b.id;
    const luas = Number(b.luas_ha || 0);
    const label = `${name} | ${nf.format(luas)} Ha`;
    $('#in-blok').value = label;
    applyBlock(b);
  } else {
    $('#in-blok').value = rec.blok_id || '';
  }

  $('#in-luas').value = rec.luas_panen_ha ?? '';
  $('#in-jjg').value = rec.jjg ?? '';
  $('#in-br').value = rec.brondolan_kg ?? '';
  $('#in-hk').value = rec.hk ?? '';
  $('#in-note').value = rec.catatan ?? '';

  const c = compute(rec);
  setKPI(c.bjr, c.tonase_ton, c.tonPerHK, c.tonPerHa, c.lfPct);
  showToast('Mode edit: data dimuat');
  return editId;
}

export function render(app) {
  app.innerHTML = view();
  fillBlockDatalist();
  bindCompute();
  $('#btn-bulk-input') ?.addEventListener('click', openBulkModal);

  // event blok typing/blur → resolve
  $('#in-blok').addEventListener('change', () => {
    const b = resolveBlock($('#in-blok').value);
    applyBlock(b);
  });
  $('#in-blok').addEventListener('blur', () => {
    const b = resolveBlock($('#in-blok').value);
    applyBlock(b);
  });
  $('#in-blok').addEventListener('input', () => {
    // reset sementara agar tidak misleading
    SELECTED_BLOCK = null;
    $('#in-divisi').value = '';
    $('#in-kadvel').value = '';
  });

  const editId = prefillIfEdit();

  $('#btn-save').addEventListener('click', () => {
    const rec = collect();
    $('#btn-bulk-input') ?.addEventListener('click', openBulkModal);
    const err = validate(rec);
    if (err) {
      showToast(err);
      return;
    }

    const list = LStore.getArr(Keys.INPUT_RECORDS);
    const exist = list.find(r => r.local_id === rec.local_id);

    // jika datang dari mode edit & kunci berubah, hapus record lama
    if (editId && editId !== rec.local_id) {
      const filtered = list.filter(r => r.local_id !== editId);
      LStore.setArr(Keys.INPUT_RECORDS, filtered);
      const q = new Set(LStore.getArr(Keys.SYNC_QUEUE));
      q.delete(editId);
      LStore.setArr(Keys.SYNC_QUEUE, [...q]);
    }

    if (exist) {
      rec.created_at = exist.created_at;
      rec.sync_status = exist.sync_status === 'synced' ? 'edited' : 'pending';
    }
    rec.updated_at = nowISO();

    upsertRecord(rec);
    SyncState.enqueue(rec.local_id);

    if (editId) sessionStorage.removeItem('edit.local_id');

    showToast('Tersimpan ke lokal & masuk antrian sinkron');

    // 🔽 reset semua field kecuali tanggal
    resetFieldsAfterSave();
  });


  $('#btn-reset').addEventListener('click', () => {
    $('#in-blok').value = '';
    $('#in-divisi').value = '';
    $('#in-kadvel').value = '';
    $('#in-luas').value = '';
    $('#in-jjg').value = '';
    $('#in-br').value = '';
    $('#in-hk').value = '';
    $('#in-note').value = '';
    SELECTED_BLOCK = null;
    setKPI(0, 0, 0, 0);
  });
}

// ===============================
// BULK UPLOAD INPUT PANEN (.xlsx)
// ===============================

// --- FNV-1a (samakan dengan GAS) ---
function fnv1a(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

function serverKeyFrom(rec) {
  return fnv1a(String(rec.nik_mandor || '') + '|' + String(rec.tanggal || '') + '|' + String(rec.blok_id || ''));
}

// --- helper tanggal (Excel serial / dd-mm / yyyy-mm-dd) → 'YYYY-MM-DD' ---
function toISODateAny(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const y = v.getFullYear(),
      m = String(v.getMonth() + 1).padStart(2, '0'),
      d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    const y = d.getFullYear(),
      m = String(d.getMonth() + 1).padStart(2, '0'),
      dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  const s = String(v).trim();
  // 2025-09-17 → biarkan
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 17/09/2025 atau 17-09-2025
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const dd = String(+m[1]).padStart(2, '0'),
      mm = String(+m[2]).padStart(2, '0');
    const yy = m[3].length === 2 ? ('20' + m[3]) : m[3];
    return `${yy}-${mm}-${dd}`;
  }
  return s; // fallback
}

// --- header yang didukung (case-insensitive + sinonim) ---
const INPUT_HEADERS = {
  tanggal: ['tanggal', 'tgl', 'date'],
  divisi_id: ['divisi_id', 'divisi'],
  blok_id: ['blok_id', 'blok', 'id_blok', 'kode_blok'],
  kadvel_id: ['kadvel_id', 'kadvel'],
  luas_panen_ha: ['luas_panen_ha', 'luas', 'luas_ha', 'ha', 'hektar', 'luas panen'],
  jjg: ['jjg', 'tandan', 'buah'],
  brondolan_kg: ['brondolan_kg', 'brondolan', 'brd'],
  hk: ['hk', 'hari_kerja', 'hko'],
  tonase_ton: ['tonase_ton', 'tonase', 'ton'],
  nik_mandor: ['nik_mandor', 'nik'],
  nama_mandor: ['nama_mandor', 'nama'],
  catatan: ['catatan', 'note', 'ket'],
};

// --- cari kolom berdasarkan sinonim ---
function _buildColIndex(headerRow) {
  const idx = {};
  const lower = headerRow.map(h => String(h || '').trim().toLowerCase());
  for (const [std, alts] of Object.entries(INPUT_HEADERS)) {
    let pos = -1;
    for (const a of alts) {
      const i = lower.indexOf(a);
      if (i >= 0) {
        pos = i;
        break;
      }
    }
    idx[std] = pos;
  }
  return idx;
}

// --- parse WB ke array record standar (validasi minimal) ---
async function parseInputXLSX(file) {
  if (!file) throw new Error('Pilih file .xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: 'array'
  });

  // pilih sheet "input" | "pusingan" | sheet pertama
  let ws = wb.Sheets['input'] || wb.Sheets['pusingan'];
  if (!ws) ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Sheet tidak ditemukan');

  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: ''
  });
  if (!aoa.length) return [];

  const header = aoa[0];
  const col = _buildColIndex(header);

  const masterBlok = LStore.getArr(Keys.MASTER_BLOK) || [];
  const masterMandor = LStore.getArr(Keys.MASTER_MANDOR) || [];
  const blokById = new Map(masterBlok.map(b => [String(b.id), b]));
  const mandorByNik = new Map(masterMandor.map(m => [String(m.nik), m]));

  const out = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every(v => v === '' || v == null)) continue;

    const rec = {
      tanggal: toISODateAny(col.tanggal >= 0 ? row[col.tanggal] : ''),
      divisi_id: col.divisi_id >= 0 ? String(row[col.divisi_id] || '') : '',
      blok_id: col.blok_id >= 0 ? String(row[col.blok_id] || '') : '',
      kadvel_id: col.kadvel_id >= 0 ? String(row[col.kadvel_id] || '') : '',
      luas_panen_ha: ensureNumber(col.luas_panen_ha >= 0 ? row[col.luas_panen_ha] : 0, 0),
      jjg: ensureNumber(col.jjg >= 0 ? row[col.jjg] : 0, 0),
      brondolan_kg: ensureNumber(col.brondolan_kg >= 0 ? row[col.brondolan_kg] : 0, 0),
      hk: ensureNumber(col.hk >= 0 ? row[col.hk] : 0, 0),
      tonase_ton: ensureNumber(col.tonase_ton >= 0 ? row[col.tonase_ton] : 0, 0),
      nik_mandor: col.nik_mandor >= 0 ? String(row[col.nik_mandor] || '') : '',
      nama_mandor: col.nama_mandor >= 0 ? String(row[col.nama_mandor] || '') : '',
      catatan: col.catatan >= 0 ? String(row[col.catatan] || '') : '',
    };

    // auto-isi dari master bila kosong
    if (rec.blok_id && (!rec.divisi_id || !rec.kadvel_id)) {
      const mb = blokById.get(rec.blok_id);
      if (mb) {
        if (!rec.divisi_id) rec.divisi_id = String(mb.divisi_id || '');
        if (!rec.kadvel_id) rec.kadvel_id = String(mb.kadvel_id || '');
        if (!rec.nik_mandor && mb.mandor_nik) rec.nik_mandor = String(mb.mandor_nik);
      }
    }
    if (rec.nik_mandor && !rec.nama_mandor) {
      const mm = mandorByNik.get(rec.nik_mandor);
      if (mm) rec.nama_mandor = mm.nama || '';
    }

    // validasi minimal
    const errors = [];
    if (!rec.tanggal) errors.push('tgl');
    if (!rec.blok_id) errors.push('blok');
    if (!rec.nik_mandor) errors.push('nik');

    out.push({
      rec,
      errors
    });
  }
  return out;
}

// --- render preview ke HTML table ---
function renderPreviewRows(rows, limit = 1000) {
  if (!rows.length) return '<div class="warn">Tidak ada data terdeteksi.</div>';
  const head = ['#', 'Tanggal', 'Divisi', 'Blok', 'Kadvel', 'Luas(ha)', 'JJG', 'Brd(kg)', 'HK', 'Ton(t)', 'NIK', 'Nama', 'Catatan', 'Status'];
  const body = rows.slice(0, limit).map((x, i) => {
    const r = x.rec;
    const st = x.errors.length ? `<span class="badge danger">${x.errors.join(',')}</span>` : '<span class="badge success">OK</span>';
    return `<tr>
      <td>${i+1}</td>
      <td>${r.tanggal||''}</td>
      <td>${r.divisi_id||''}</td>
      <td>${r.blok_id||''}</td>
      <td>${r.kadvel_id||''}</td>
      <td>${Number.isFinite(r.luas_panen_ha)? r.luas_panen_ha.toFixed(2) : ''}</td>
      <td>${r.jjg||0}</td>
      <td>${r.brondolan_kg||0}</td>
      <td>${r.hk||0}</td>
      <td>${Number.isFinite(r.tonase_ton)? r.tonase_ton.toFixed(2) : ''}</td>
      <td>${r.nik_mandor||''}</td>
      <td>${r.nama_mandor||''}</td>
      <td>${r.catatan||''}</td>
      <td>${st}</td>
    </tr>`;
  }).join('');
  return `
    <div style="margin:.5rem 0">Total baris: <b>${rows.length}</b></div>
    <div style="max-height:50vh;overflow:auto;border:1px solid var(--border);border-radius:8px">
      <table class="table" style="width:100%;border-collapse:collapse">
        <thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// --- Template contoh untuk input panen (.xlsx) ---
function downloadInputTemplateXLSX() {
  if (typeof XLSX === 'undefined') {
    alert('Library XLSX belum termuat');
    return;
  }
  const headers = [
    'tanggal', 'divisi_id', 'blok_id', 'kadvel_id', 'luas_panen_ha', 'jjg', 'brondolan_kg', 'hk', 'tonase_ton', 'nik_mandor', 'nama_mandor', 'catatan'
  ];
  const sample = [
    ['2025-01-03', 'DIV1', 'B1', 'K1', 12.50, 1200, 85, 14, 18.75, '111', 'Pak Budi', 'Contoh baris'],
    ['2025-01-04', 'DIV1', 'B2', 'K1', 0.00, 0, 0, 0, 0.00, '111', 'Pak Budi', 'Hari kosong']
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws['!cols'] = headers.map(() => ({
    wch: 14
  }));
  XLSX.utils.book_append_sheet(wb, ws, 'input');
  XLSX.writeFile(wb, 'template_input_panen.xlsx');
}

// --- Modal builder + handlers ---
function openBulkModal() {
  // buat container modal sekali saja
  let wrap = document.getElementById('bulk-upload-modal');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'bulk-upload-modal';
    wrap.innerHTML = `
      <div class="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000;">
        <div class="card" style="width:min(1100px,95vw);max-height:90vh;overflow:auto">
          <div class="row" style="justify-content:space-between;align-items:center">
            <h3 style="margin:0">Upload Input Panen (.xlsx)</h3>
            <button id="bulk-close">Tutup</button>
          </div>
          <div class="row" style="gap:8px;margin:.5rem 0">
            <input type="file" id="bulk-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <button id="bulk-template">Download Template</button>
          </div>
          <div id="bulk-info" class="muted" style="margin:.25rem 0">Pilih file lalu akan muncul preview…</div>
          <div id="bulk-preview" style="margin-top:.5rem"></div>
          <div id="bulk-results" style="display:none;margin-top:.75rem">
  <div id="bulk-summary" class="muted"></div>
  <div class="row" style="gap:8px;justify-content:flex-end;margin-top:.5rem">
    <button id="bulk-retry" class="secondary" style="display:none">Unggah Ulang yang Gagal</button>
    <button id="bulk-download-failed" class="secondary" style="display:none">Unduh Data Gagal (.xlsx)</button>
  </div>
  <div id="bulk-failed-table" style="max-height:40vh;overflow:auto;margin-top:.5rem"></div>
</div>
          <div class="row" style="justify-content:flex-end;gap:8px;margin-top:.75rem">
            <button id="bulk-upload" class="primary" disabled>Upload</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    // events
    wrap.querySelector('#bulk-close').addEventListener('click', () => wrap.remove());
    wrap.querySelector('#bulk-template').addEventListener('click', downloadInputTemplateXLSX);

    const fileEl = wrap.querySelector('#bulk-file');
    const btnUpload = wrap.querySelector('#bulk-upload');
    const infoEl = wrap.querySelector('#bulk-info');
    const prevEl = wrap.querySelector('#bulk-preview');

    let parsedRows = [];
    let failedRows = []; // { idx, rec, error, phase }

    function renderFailedTable(failed) {
      if (!failed.length) return '';
      const head = ['#', 'Tanggal', 'Blok', 'NIK', 'Luas(ha)', 'JJG', 'HK', 'Error'];
      const rows = failed.map(x => {
        const r = x.rec;
        return `<tr>
      <td>${x.idx}</td>
      <td>${r.tanggal||''}</td>
      <td>${r.blok_id||''}</td>
      <td>${r.nik_mandor||''}</td>
      <td>${Number.isFinite(r.luas_panen_ha)? r.luas_panen_ha.toFixed(2):''}</td>
      <td>${r.jjg||0}</td>
      <td>${r.hk||0}</td>
      <td class="kiri">${x.error||''}</td>
    </tr>`;
      }).join('');
      return `
    <table class="table" style="width:100%;border-collapse:collapse">
      <thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    }

    function downloadFailedXLSX(failed) {
      if (!failed.length) return;
      const headers = ['tanggal', 'divisi_id', 'blok_id', 'kadvel_id', 'luas_panen_ha', 'jjg', 'brondolan_kg', 'hk', 'tonase_ton', 'nik_mandor', 'nama_mandor', 'catatan', 'error'];
      const data = failed.map(x => {
        const r = x.rec;
        return [r.tanggal, r.divisi_id, r.blok_id, r.kadvel_id, r.luas_panen_ha, r.jjg, r.brondolan_kg, r.hk, r.tonase_ton, r.nik_mandor, r.nama_mandor, r.catatan, (x.error || '')];
      });
      if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        ws['!cols'] = headers.map(() => ({
          wch: 14
        }));
        XLSX.utils.book_append_sheet(wb, ws, 'gagal');
        XLSX.writeFile(wb, 'rekap_gagal_upload_input.xlsx');
      } else {
        // fallback CSV
        const csv = [headers.join(','), ...data.map(row => row.map(v => {
          const s = (v == null ? '' : String(v));
          return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        }).join(','))].join('\n');
        const blob = new Blob([csv], {
          type: 'text/csv;charset=utf-8;'
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'rekap_gagal_upload_input.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }

    async function doParse() {
      try {
        const f = fileEl.files && fileEl.files[0];
        failedRows = []; // reset rekap
        wrap.querySelector('#bulk-results').style.display = 'none';
        wrap.querySelector('#bulk-failed-table').innerHTML = '';
        wrap.querySelector('#bulk-summary').textContent = '';
        wrap.querySelector('#bulk-retry').style.display = 'none';
        wrap.querySelector('#bulk-download-failed').style.display = 'none';
        if (!f) {
          prevEl.innerHTML = '';
          btnUpload.disabled = true;
          return;
        }
        infoEl.textContent = 'Membaca & mem-parsing file…';
        parsedRows = await parseInputXLSX(f);
        prevEl.innerHTML = renderPreviewRows(parsedRows);
        const bad = parsedRows.filter(x => x.errors.length).length;
        if (parsedRows.length === 0) {
          infoEl.innerHTML = '<span class="warn">Tidak ada baris valid untuk diunggah.</span>';
          btnUpload.disabled = true;
        } else if (bad > 0) {
          infoEl.innerHTML = `<span class="warn">Ada ${bad} baris belum lengkap (tgl/blok/nik). Baris tsb tetap bisa diunggah, tapi akan <b>gagal</b> di server. Perbaiki dulu jika perlu.</span>`;
          btnUpload.disabled = false;
        } else {
          infoEl.textContent = 'Siap diunggah.';
          btnUpload.disabled = false;
        }
      } catch (e) {
        prevEl.innerHTML = `<div class="warn">${e.message||e}</div>`;
        btnUpload.disabled = true;
      }
    }
    fileEl.addEventListener('change', doParse);

    btnUpload.addEventListener('click', async () => {
      if (!parsedRows.length) return;
      btnUpload.disabled = true;

      // siapkan progress
      const N = parsedRows.length;
      failedRows = []; // rekap baru
      Progress.open({
        title: 'Upload Data Aktual',
        subtitle: 'Mengunggah…'
      });
      Progress.switchToDeterminate(Math.max(1, N));

      let ok = 0,
        fail = 0;

      for (let i = 0; i < N; i++) {
        const r = parsedRows[i].rec;

        // bentuk payload sesuai HEAD GAS
        const rec = {
          tanggal: r.tanggal,
          divisi_id: r.divisi_id || '',
          blok_id: r.blok_id || '',
          kadvel_id: r.kadvel_id || '',
          luas_panen_ha: ensureNumber(r.luas_panen_ha, 0),
          jjg: ensureNumber(r.jjg, 0),
          brondolan_kg: ensureNumber(r.brondolan_kg, 0),
          hk: ensureNumber(r.hk, 0),
          tonase_ton: ensureNumber(r.tonase_ton, 0),
          nik_mandor: r.nik_mandor || '',
          nama_mandor: r.nama_mandor || '',
          catatan: r.catatan || '',
        };

        try {
          const key = serverKeyFrom(rec);

          // --- cek eksistensi: fetch → fallback JSONP
          let exists = false;
          try {
            const ch = await API.checkKey({
              key
            });
            if (!ch || !ch.ok) throw new Error(ch ?.error || 'cek gagal');
            exists = !!(ch.data && ch.data.exists);
          } catch (_errCheck) {
            if (!hasJSONPFallback()) throw _errCheck;
            const rj = await gasJSONP('pusingan.check', {
              key
            });
            if (!rj || !rj.ok) throw new Error(rj ?.error || 'cek(JSONP) gagal');
            exists = !!(rj.data && rj.data.exists);
          }

          // --- insert/update: fetch → fallback JSONP
          if (exists) {
            try {
              const up = await API.pushUpdate({
                key,
                record: rec
              });
              if (!up || !up.ok) throw new Error(up ?.error || 'update failed');
            } catch (_errUpd) {
              if (!hasJSONPFallback()) throw _errUpd;
              const rj = await gasJSONP('pusingan.update', {
                key,
                payload: JSON.stringify(rec)
              });
              if (!rj || !rj.ok) throw new Error(rj ?.error || 'update(JSONP) gagal');
            }
          } else {
            try {
              const ins = await API.pushInsert({
                record: rec
              });
              if (!ins || !ins.ok) throw new Error(ins ?.error || 'insert failed');
            } catch (_errIns) {
              if (!hasJSONPFallback()) throw _errIns;
              const rj = await gasJSONP('pusingan.insert', {
                payload: JSON.stringify(rec)
              });
              if (!rj || !rj.ok) throw new Error(rj ?.error || 'insert(JSONP) gagal');
            }
          }

          ok++;
        } catch (e) {
          fail++;
          failedRows.push({
            idx: i + 1,
            rec,
            error: (e && e.message) ? e.message : String(e)
          });
        } finally {
          Progress.tick(i + 1, N);
        }
      }

      Progress.update('Selesai');
      Progress.close();

      showToast(`Upload selesai: ${ok} ok, ${fail} gagal`);
      // tampilkan rekap gagal (jika ada)
      const resWrap = wrap.querySelector('#bulk-results');
      const sumEl = wrap.querySelector('#bulk-summary');
      const tblEl = wrap.querySelector('#bulk-failed-table');
      const btnDl = wrap.querySelector('#bulk-download-failed');
      const btnRt = wrap.querySelector('#bulk-retry');

      if (fail > 0) {
        resWrap.style.display = 'block';
        sumEl.innerHTML = `Ada <b>${fail}</b> baris gagal. Anda bisa <b>Unduh</b> rekapnya atau <b>Unggah Ulang</b> hanya baris yang gagal.`;
        tblEl.innerHTML = renderFailedTable(failedRows);
        btnDl.style.display = 'inline-block';
        btnRt.style.display = 'inline-block';
      } else {
        // semua sukses → tutup modal
        document.getElementById('bulk-upload-modal') ?.remove();
      }

      btnUpload.disabled = false;
    });

    wrap.querySelector('#bulk-download-failed').addEventListener('click', () => {
      if (!failedRows.length) return;
      downloadFailedXLSX(failedRows);
    });

    wrap.querySelector('#bulk-retry').addEventListener('click', () => {
      if (!failedRows.length) return;
      // set preview hanya baris gagal → user klik "Upload" lagi
      parsedRows = failedRows.map(x => ({
        rec: x.rec,
        errors: []
      }));
      failedRows = [];
      prevEl.innerHTML = renderPreviewRows(parsedRows);
      infoEl.textContent = 'Siap unggah ulang: hanya baris yang gagal sebelumnya.';
      wrap.querySelector('#bulk-results').style.display = 'none';
      btnUpload.disabled = false;
    });

  }
}

// --- tombol pemicu di halaman input ---
// panggil fungsi ini setelah halaman input dirender
export function mountBulkUploadInput(targetSelector = '#input-actions') {
  // buat tombol
  let host = document.querySelector(targetSelector);
  if (!host) {
    // fallback: sisipkan di header card pertama
    host = document.querySelector('.card .row') || document.body;
  }
  const btn = document.createElement('button');
  btn.id = 'btn-bulk-input';
  btn.textContent = 'Upload Data (.xlsx)';
  btn.className = 'secondary';
  btn.addEventListener('click', openBulkModal);
  host.appendChild(btn);
}