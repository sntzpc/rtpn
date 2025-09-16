// =====================
// File: features/settings.js (rapi + libur + progress + JSONP anti-CORS)
// =====================
import {
    $,
    ensureNumber,
    hash
} from '../core/utils.js';
import {
    Keys,
    LStore
} from '../core/storage.js';
import {
    API
} from '../core/api.js';
import {
    Theme,
    getTheme,
    setTheme,
    applyTheme
} from '../core/theme.js';
import {
    Progress
} from '../core/progress.js';

// ---------- Utilities ----------
async function confirmDialog(message) {
    try {
        return !!window.confirm(message);
    } catch {
        return false;
    }
}

function hashPlain(p) {
    let h = 0;
    for (let i = 0; i < p.length; i++) {
        h = (h * 31 + p.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
}

// ------- GAS base URL resolver (opsional, hanya untuk JSONP fallback) -------
function _gasBase() {
    const fromWindow = (typeof window !== 'undefined' && window.GAS_BASE_URL) || '';
    const fromLS = localStorage.getItem('API_BASE') || '';
    const base = (fromWindow || fromLS || '').replace(/\/$/, '');
    if (!base) throw new Error('JSONP fallback tidak dikonfigurasi (set window.GAS_BASE_URL atau localStorage "API_BASE").');
    if (/macros\/echo\b/.test(base)) console.error('URL GAS salah: jangan pakai /macros/echo — gunakan /exec.');
    return base;
}

// Apakah JSONP fallback tersedia?
function hasJSONPFallback() {
    return !!(
        (typeof window !== 'undefined' && window.GAS_BASE_URL) ||
        localStorage.getItem('API_BASE')
    );
}

// ------- JSONP helper (dipakai HANYA jika hasJSONPFallback() true) -------
function gasJSONP(route, params = {}) {
    const base = _gasBase(); // akan throw bila tidak dikonfigurasi → kita cegah di caller
    return new Promise((resolve, reject) => {
        const cb = '__jsonp_cb_' + Math.random().toString(36).slice(2);
        const withCb = {
            ...params,
            route,
            callback: cb
        };
        const qs = Object.entries(withCb)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)}`)
            .join('&');

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

// ---------- View ----------
function view() {
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

  <!-- SECTION: khusus ASISTEN -->
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

    <div class="card" id="section-users">
      <div class="row" style="align-items:center;gap:8px">
        <h3 style="margin:0">Kelola User (Asisten)</h3>
        <span class="badge">Total: <b id="user-count">0</b></span>
        <button id="btn-refresh-users">Refresh</button>
      </div>

      <div class="row" style="margin-top:8px">
        <div class="col"><input id="u-nik"  placeholder="NIK" /></div>
        <div class="col"><input id="u-nama" placeholder="Nama" /></div>
        <div class="col">
          <select id="u-role"><option value="mandor">Mandor</option><option value="asisten">Asisten</option></select>
        </div>
        <div class="col">
          <button id="u-add">Tambah User (pwd: user123)</button>
        </div>
      </div>

      <div id="user-list" style="margin-top:10px"></div>
    </div>

  </div>`;
}

// ---------- Bind ----------
function bind() {
    // Prefill
    $('#set-role').value = localStorage.getItem(Keys.ROLE) || '-';
    $('#set-nik').value = localStorage.getItem(Keys.NIK) || '';

    // Theme toggle (header)
    const chkDark = $('#toggle-dark');
    if (chkDark) {
        chkDark.checked = (getTheme() === Theme.DARK);
        chkDark.addEventListener('change', () => {
            setTheme(chkDark.checked ? Theme.DARK : Theme.LIGHT);
            applyTheme();
            showToast(`Tema diubah ke ${chkDark.checked ? 'Dark' : 'Light'}`);
        });
    }

    ensureAsistenSections();
    if ((localStorage.getItem(Keys.ROLE) || '-') === 'asisten') refreshUsersUI();

    // LOGIN
    $('#btn-login').addEventListener('click', async () => {
        const role = $('#set-role').value;
        const nik = ($('#set-nik').value || '').trim();
        const pass = $('#set-pass').value;
        if (!role || role === '-') return showToast('Pilih role');
        if (!nik || !pass) return showToast('NIK & Password wajib');
        try {
            spinner(true);
            const pass_hash = hashPlain(pass);
            const res = await API.login({
                nik,
                pass_hash,
                role
            });
            if (!res.ok) throw new Error(res.error || 'Login gagal');
            localStorage.setItem(Keys.ROLE, role);
            localStorage.setItem(Keys.NIK, nik);
            localStorage.setItem(Keys.NAME, res.data ?.name || (role === 'asisten' ? 'Asisten' : 'Mandor'));
            localStorage.setItem(Keys.TOKEN, pass_hash);
            const roleLabel = role === 'asisten' ? 'Asisten' : 'Mandor';
            const text = `Aktif: ${roleLabel} — ${localStorage.getItem(Keys.NAME)} (${nik})`;
            const elRole = document.getElementById('role-badge');
            if (elRole) elRole.textContent = text;
            const elUser = document.getElementById('user-badge');
            if (elUser) elUser.textContent = localStorage.getItem(Keys.NAME) || nik;
            ensureAsistenSections();
            if (role === 'asisten') await refreshUsersUI();
            $('#set-pass').value = '';
            showToast('Login sukses');
        } catch (e) {
            showToast(e.message || 'Login gagal');
        } finally {
            spinner(false);
        }
    });

    // TARIK MASTER (fetch → fallback JSONP)
    $('#btn-master-pull').addEventListener('click', async () => {
        const role = localStorage.getItem(Keys.ROLE) || '-';
        const nik = localStorage.getItem(Keys.NIK) || '';
        if (role === '-') return showToast('Set role dulu');
        try {
            Progress.open({
                title: 'Tarik Master Data',
                subtitle: 'Meminta data…'
            });
            let data;
            try {
                const res = await API.masterPull({
                    role,
                    nik
                });
                if (!res.ok) throw new Error(res.error || 'fetch gagal');
                data = res.data || {};
            } catch (errFetch) {
                if (!hasJSONPFallback()) throw errFetch; // ⬅️ jangan pakai JSONP jika tidak dikonfigurasi
                const r = await gasJSONP('master.pull', {
                    role,
                    nik
                });
                if (!r || !r.ok) throw new Error(r ?.error || 'Gagal tarik master (JSONP)');
                data = r.data || {};
            }
            const MAP = {
                company: Keys.MASTER_COMPANY,
                estate: Keys.MASTER_ESTATE,
                divisi: Keys.MASTER_DIVISI,
                kadvel: Keys.MASTER_KADVEL,
                blok: Keys.MASTER_BLOK,
                mandor: Keys.MASTER_MANDOR,
                asisten: Keys.MASTER_ASISTEN,
                libur: Keys.MASTER_LIBUR,
            };
            const keys = Object.keys(MAP);
            Progress.switchToDeterminate(keys.length);
            let i = 0;
            for (const k of keys) {
                i++;
                Progress.update(`Menyimpan ${k}…`);
                LStore.setArr(MAP[k], Array.isArray(data[k]) ? data[k] : []);
                Progress.tick(i, keys.length);
            }
            Progress.update('Selesai');
            showToast('Master tersimpan ke lokal');
        } catch (e) {
            showToast(e.message || 'Gagal tarik master');
        } finally {
            Progress.close();
        }
    });

    // DOWNLOAD DATA AKTUAL (fetch → fallback JSONP)
    $('#btn-download-data').addEventListener('click', async () => {
        const role = localStorage.getItem(Keys.ROLE) || '-';
        const nik = localStorage.getItem(Keys.NIK) || '';
        if (role === '-') return showToast('Set role dulu');
        try {
            Progress.open({
                title: 'Download Data Aktual',
                subtitle: 'Meminta ke server…'
            });
            const month = '';
            const year = '';
            let rows = [];
            try {
                const res = await API.actualPull({
                    role,
                    nik,
                    month,
                    year
                });
                if (!res.ok) throw new Error(res.error || 'fetch gagal');
                rows = Array.isArray(res.data ?.rows) ? res.data.rows : [];
            } catch (errFetch) {
                if (!hasJSONPFallback()) throw errFetch; // ⬅️ cegah error “GAS_BASE_URL…”
                const r = await gasJSONP('actual.pull', {
                    role,
                    nik,
                    month,
                    year
                });
                if (!r || !r.ok) throw new Error(r ?.error || 'Gagal download (JSONP)');
                rows = Array.isArray(r.data ?.rows) ? r.data.rows : [];
            }
            const normalized = rows.map(r => {
                const local_id = r.local_id || hash(`${r.nik_mandor||''}|${r.tanggal||''}|${r.blok_id||''}`);
                const created = r.created_at || r.updated_at || new Date().toISOString();
                const updated = r.updated_at || created;
                return {
                    local_id,
                    server_id: r.server_id || '',
                    nik_mandor: r.nik_mandor || '',
                    nama_mandor: r.nama_mandor || '',
                    divisi_id: r.divisi_id || '',
                    blok_id: r.blok_id || '',
                    kadvel_id: r.kadvel_id || '',
                    tanggal: r.tanggal || '',
                    luas_panen_ha: ensureNumber(r.luas_panen_ha, 0),
                    jjg: ensureNumber(r.jjg, 0),
                    brondolan_kg: ensureNumber(r.brondolan_kg, 0),
                    hk: ensureNumber(r.hk, 0),
                    tonase_ton: ensureNumber(r.tonase_ton, 0),
                    catatan: r.catatan || '',
                    sync_status: 'synced',
                    created_at: created,
                    updated_at: updated,
                };
            });
            Progress.switchToDeterminate(Math.max(1, normalized.length));
            Progress.update('Menyimpan ke lokal…');
            const map = new Map();
            (LStore.getArr(Keys.INPUT_RECORDS) || []).forEach(x => map.set(x.local_id, x));
            let i = 0;
            for (const x of normalized) {
                map.set(x.local_id, x);
                i++;
                if (i % 50 === 0) Progress.tick(i, normalized.length);
            }
            Progress.tick(normalized.length, normalized.length);
            const merged = [...map.values()].sort((a, b) => a.tanggal > b.tanggal ? -1 : 1);
            LStore.setArr(Keys.INPUT_RECORDS, merged);
            const q = new Set(LStore.getArr(Keys.SYNC_QUEUE) || []);
            normalized.forEach(x => q.delete(x.local_id));
            LStore.setArr(Keys.SYNC_QUEUE, [...q]);
            Progress.update('Selesai');
            showToast(`Data aktual terunduh: ${normalized.length} baris`);
        } catch (e) {
            showToast(e.message || 'Gagal mengunduh data');
        } finally {
            Progress.close();
        }
    });

    // RESET LOKAL
    $('#btn-reset-local').addEventListener('click', async () => {
        const ok = await confirmDialog('Yakin hapus SEMUA data lokal? Tindakan ini memerlukan password aktif.');
        if (!ok) return;
        const pass = prompt('Masukkan password aktif untuk konfirmasi:');
        const token = localStorage.getItem(Keys.TOKEN) || '';
        if (!pass || hashPlain(pass) !== token) {
            showToast('Password salah');
            return;
        }
        LStore.clearAll();
        showToast('Data lokal dihapus');
        location.reload();
    });

    // TEMPLATE MASTER
    $('#btn-download-template').addEventListener('click', () => {
        try {
            downloadMasterTemplateXLSX();
        } catch (e) {
            showToast(e.message || 'Gagal membuat template');
        }
    });

    // UPLOAD MASTER (fetch bulk → fallback JSONP per-sheet)
    $('#btn-upload-master').addEventListener('click', async () => {
        const f = document.getElementById('file-master').files[0];
        if (!f) return showToast('Pilih file .xlsx');
        try {
            Progress.open({
                title: 'Upload Master',
                subtitle: 'Membaca file…'
            });
            const parsed = await parseMasterXLSX(f);

            // Validasi sheet BLOK
            if (Array.isArray(parsed.blok)) {
                for (const b of parsed.blok) {
                    if (!b.kadvel_id) throw new Error(`kadvel_id wajib pada blok ${b.kode||b.id||'(tanpa kode)'}`);
                    if (b.bjr_kg_per_jjg == null || Number(b.bjr_kg_per_jjg) <= 0) {
                        throw new Error(`BJR tidak valid pada blok ${b.kode||b.id||'(tanpa kode)'}`);
                    }
                }
            }

            // Simpan lokal per sheet (progress)
            const parts = Object.keys(parsed);
            Progress.switchToDeterminate(parts.length + 1);
            let step = 0;
            for (const k of parts) {
                step++;
                Progress.update(`Menyimpan ${k}…`);
                applyMasterJSON({
                    [k]: parsed[k]
                });
                Progress.tick(step, parts.length + 1);
            }

            // Push ke server: coba sekali bulk fetch
            Progress.update('Mengunggah (bulk)…');
            let pushed = false;
            try {
                const compact = Object.fromEntries( Object.entries(parsed).filter(([_, arr]) => Array.isArray(arr) && arr.length > 0));
                const res = await API.masterPush({ items: compact });
                if (!res || !res.ok) throw new Error(res ?.error || 'bulk gagal');
                pushed = true;
            } catch (_bulkErr) {
                if (!hasJSONPFallback()) throw _bulkErr; // ⬅️ jangan paksa JSONP kalau tidak diset

                // Fallback JSONP per-sheet (anti URL panjang)
                const order = ['company', 'estate', 'divisi', 'kadvel', 'blok', 'mandor', 'asisten', 'libur'];
                const present = order.filter(k => Array.isArray(parsed[k]) && parsed[k].length);
                Progress.switchToDeterminate(present.length);
                let i = 0;
                for (const k of order) {
                    const arr = parsed[k];
                    if (!Array.isArray(arr) || arr.length === 0) continue;
                    i++;
                    Progress.update(`Upload ${k}…`);
                    const r = await gasJSONP('master.push', {
                        payload: JSON.stringify({
                            [k]: arr
                        })
                    });
                    if (!r || !r.ok) throw new Error(r ?.error || `Gagal unggah ${k}`);
                    Progress.tick(i, present.length);
                }
                pushed = true;
            }

            Progress.update('Selesai');
            if (pushed) showToast('Master .xlsx tersimpan (lokal & server)');
        } catch (e) {
            showToast(e.message || 'Gagal memproses file .xlsx');
        } finally {
            Progress.close();
        }
    });

    // USERS
    $('#btn-refresh-users') ?.addEventListener('click', refreshUsersUI);
    $('#u-add').addEventListener('click', async () => {
        const nik = ($('#u-nik').value || '').trim();
        const nama = ($('#u-nama').value || '').trim() || nik;
        const role = $('#u-role').value || 'mandor';
        if (!nik) return showToast('Isi NIK terlebih dulu');
        try {
            spinner(true);
            const pass_hash = hashPlain('user123');
            const res = await API.userAdd({
                nik,
                name: nama,
                role,
                pass_hash
            });
            if (!res.ok) throw new Error(res.error || 'Gagal tambah user');
            showToast('User disimpan (password default: user123)');
            await refreshUsersUI();
        } catch (e) {
            showToast(e.message || 'Gagal tambah user');
        } finally {
            spinner(false);
        }
    });

    // Aksi tabel user
    $('#user-list').addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const nik = btn.getAttribute('data-nik');

        if (action === 'passwd') {
            const newPass = prompt(`Masukkan password baru untuk NIK ${nik} (kosongkan untuk 'user123'):`) || 'user123';
            try {
                spinner(true);
                const pass_hash = hashPlain(newPass);
                const res = await API.userReset({
                    nik,
                    pass_hash
                });
                if (!res.ok) throw new Error(res.error || 'Gagal ubah password');
                showToast('Password diperbarui');
            } catch (e) {
                showToast(e.message || 'Gagal ubah password');
            } finally {
                spinner(false);
            }
        }

        if (action === 'delete') {
            const ok = await confirmDialog(`Hapus user NIK ${nik}? Tindakan ini tidak dapat dibatalkan.`);
            if (!ok) return;
            try {
                spinner(true);
                const res = await API.userDelete({
                    nik
                });
                if (!res.ok) throw new Error(res.error || 'Gagal hapus user');
                showToast('User dihapus');
                await refreshUsersUI();
            } catch (e) {
                showToast(e.message || 'Gagal hapus user');
            } finally {
                spinner(false);
            }
        }
    });
}

// ---------- Helpers ----------
function applyMasterJSON(j) {
    if (j.company) LStore.setArr(Keys.MASTER_COMPANY, j.company);
    if (j.estate) LStore.setArr(Keys.MASTER_ESTATE, j.estate);
    if (j.divisi) LStore.setArr(Keys.MASTER_DIVISI, j.divisi);
    if (j.kadvel) LStore.setArr(Keys.MASTER_KADVEL, j.kadvel);
    if (j.blok) LStore.setArr(Keys.MASTER_BLOK, j.blok);
    if (j.mandor) LStore.setArr(Keys.MASTER_MANDOR, j.mandor);
    if (j.asisten) LStore.setArr(Keys.MASTER_ASISTEN, j.asisten);
    if (j.libur) LStore.setArr(Keys.MASTER_LIBUR, j.libur);
}

function ensureAsistenSections() {
    const role = localStorage.getItem(Keys.ROLE) || '-';
    const wrap = document.getElementById('section-asisten');
    if (!wrap) return;
    wrap.style.display = (role === 'asisten') ? 'block' : 'none';
}

function renderUserTable(users) {
    if (!Array.isArray(users) || users.length === 0) {
        $('#user-count').textContent = '0';
        return `<i>Belum ada user</i>`;
    }
    $('#user-count').textContent = String(users.length);
    return `
    <table class="table">
      <thead><tr>
        <th>#</th><th>NIK</th><th>Nama</th><th>Role</th><th>Status</th><th class="aksi">Aksi</th>
      </tr></thead>
      <tbody>
        ${users.map((u,i)=>`
          <tr>
            <td>${i+1}</td>
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
          </tr>`).join('')}
      </tbody>
    </table>`;
}
async function refreshUsersUI() {
    try {
        const res = await API.userList();
        if (!res.ok) throw new Error(res.error || 'Gagal memuat user');
        const users = res.data ?.users || [];
        $('#user-list').innerHTML = renderUserTable(users);
    } catch (e) {
        $('#user-list').innerHTML = `<div class="warn">${e.message||e}</div>`;
    }
}

// XLSX Master Helpers
const MASTER_HEADERS = {
    company: ['id', 'nama'],
    estate: ['id', 'nama', 'company_id'],
    divisi: ['id', 'kode', 'nama', 'estate_id'],
    kadvel: ['id', 'nama', 'divisi_id'],
    blok: ['id', 'kode', 'nama', 'divisi_id', 'kadvel_id', 'luas_ha', 'mandor_nik', 'bjr_kg_per_jjg'],
    mandor: ['nik', 'nama', 'divisi_id'],
    asisten: ['nik', 'nama', 'divisi_id'],
    libur: ['tanggal', 'keterangan'],
};

function _findSheet(wb, name) {
    if (wb.Sheets[name]) return wb.Sheets[name];
    const lower = name.toLowerCase();
    const matched = wb.SheetNames.find(n => String(n).toLowerCase() === lower);
    return matched ? wb.Sheets[matched] : null;
}

function _sheetToObjsWithHeader(ws, expected) {
    const aoa = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: ''
    });
    if (!aoa || aoa.length === 0) return [];
    const hdrRow = aoa[0].map(x => String(x).trim().toLowerCase());
    const need = expected.map(h => h.toLowerCase());
    const idxMap = {};
    const missing = [];
    need.forEach(h => {
        const idx = hdrRow.indexOf(h);
        if (idx < 0) missing.push(h);
        else idxMap[h] = idx;
    });
    if (missing.length) throw new Error(`Header hilang: ${missing.join(', ')}`);
    const out = [];
    for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i];
        const isEmpty = !row || row.every(v => v === '' || v == null);
        if (isEmpty) continue;
        const obj = {};
        need.forEach(h => {
            const v = row[idxMap[h]];
            obj[h] = (v == null ? '' : v);
        });
        const norm = {};
        expected.forEach((H, j) => {
            norm[H] = obj[need[j]];
        });
        out.push(norm);
    }
    return out;
}
async function parseMasterXLSX(file) {
    if (!file) throw new Error('File tidak dipilih');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {
        type: 'array'
    });
    const result = {};
    for (const [key, headers] of Object.entries(MASTER_HEADERS)) {
        const ws = _findSheet(wb, key);
        if (!ws) {
            result[key] = [];
            continue;
        }
        const arr = _sheetToObjsWithHeader(ws, headers);
        if (key === 'blok') {
            arr.forEach(b => {
                b.luas_ha = Number(b.luas_ha || 0);
                b.bjr_kg_per_jjg = Number(b.bjr_kg_per_jjg || 0);
            });
        }
        result[key] = arr;
    }
    return result;
}

function downloadMasterTemplateXLSX() {
    if (typeof XLSX === 'undefined') {
        alert('Library XLSX belum termuat');
        return;
    }
    const samples = {
        company: [
            ['PT1', 'PT BUANA TUNAS SEJAHTERA']
        ],
        estate: [
            ['EST1', 'Seriang Estate', 'PT1']
        ],
        divisi: [
            ['DIV1', 'SRIE1', 'SRIE1', 'EST1']
        ],
        kadvel: [
            ['K1', 'D-1', 'DIV1']
        ],
        blok: [
            ['B1', 'A-01', 'A-01', 'DIV1', 'K1', 25, '111', 18]
        ],
        mandor: [
            ['111', 'Budi', 'DIV1']
        ],
        asisten: [
            ['222', 'Fery', 'DIV1']
        ],
        libur: [
            ['2025-01-01', 'Tahun Baru']
        ],
    };
    const wb = XLSX.utils.book_new();
    for (const [sheet, headers] of Object.entries(MASTER_HEADERS)) {
        const body = samples[sheet] || [];
        const data = [headers, ...body];
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = headers.map((h, i) => {
            const colVals = data.map(r => (r[i] != null ? String(r[i]) : ''));
            const maxLen = Math.max(...colVals.map(v => v.length), String(h).length);
            return {
                wch: Math.max(10, maxLen + 2)
            };
        });
        XLSX.utils.book_append_sheet(wb, ws, sheet);
    }
    XLSX.writeFile(wb, 'template_master.xlsx');
}

// ---------- Mount ----------
export function render(app) {
    app.innerHTML = view();
    bind();
}