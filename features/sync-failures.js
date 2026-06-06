// =====================
// File: features/sync-failures.js
// Halaman audit data yang GAGAL sinkron + alasan + sinkron ulang.
// =====================
import { $ } from '../core/utils.js';
import { Keys, IStore } from '../core/storage.js';
import { SyncFailures, getRecord } from '../core/sync.js';
import { API } from '../core/api.js';
import { Progress } from '../core/progress.js';

const SF = { failures:[], blok:[] };

function _auth(){
  return {
    nik_auth: localStorage.getItem(Keys.NIK)   || '',
    token:    localStorage.getItem(Keys.TOKEN) || '',
  };
}
function _blokNameById(id){
  const b = (SF.blok || []).find(x => String(x.id) === String(id));
  return b ? (b.nama || b.kode || b.id) : (id || '');
}
function _fmtTs(ts){
  if (!ts) return '';
  try{
    const d = new Date(ts);
    return d.toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' });
  }catch(_){ return String(ts); }
}
function esc(s){
  return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

async function reload(){
  SF.failures = (await SyncFailures.all().catch(()=>[])) || [];
  SF.blok     = (await IStore.getArr(Keys.MASTER_BLOK).catch(()=>[])) || [];
}

function view(){
  return `
  <div class="card">
    <h2>Gagal Sinkron</h2>
    <p class="muted" style="margin-top:-4px">
      Daftar data yang gagal dikirim ke server beserta alasannya. Perbaiki bila perlu, lalu sinkron ulang.
    </p>
    <div class="row" style="gap:8px; margin-top:8px">
      <div class="col"><button class="primary" id="sf-retry-all">Sinkron Ulang Semua</button></div>
      <div class="col"><button id="sf-retry-selected">Sinkron Ulang Terpilih</button></div>
      <div class="col"><button id="sf-export">Export CSV</button></div>
      <div class="col"><button class="danger" id="sf-clear-all">Bersihkan Log</button></div>
    </div>
  </div>

  <div class="card">
    <div id="sf-summary" class="muted" style="margin-bottom:8px"></div>
    <div id="sf-table" style="overflow-x:auto"></div>
  </div>
  `;
}

function renderSummary(){
  const el = $('#sf-summary'); if (!el) return;
  const n = SF.failures.length;
  el.textContent = n === 0 ? 'Tidak ada data gagal sinkron. 🎉' : `Total gagal: ${n} baris`;
}

function renderTable(){
  const host = $('#sf-table'); if (!host) return;
  const rows = SF.failures.slice().sort((a,b)=> (a.ts < b.ts ? 1 : -1)); // terbaru dulu

  if (!rows.length){
    host.innerHTML = `<p class="muted">Belum ada catatan kegagalan.</p>`;
    return;
  }

  host.innerHTML = `
  <table class="table">
    <thead>
      <tr>
        <th><input type="checkbox" id="sf-ck-all"/></th>
        <th>Waktu Gagal</th>
        <th>Tanggal</th>
        <th>Divisi</th>
        <th>Blok</th>
        <th>Mandor</th>
        <th class="num">Coba</th>
        <th>Alasan</th>
        <th class="aksi">Aksi</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(f=>{
        const s = f.snapshot || {};
        return `
          <tr>
            <td><input type="checkbox" class="sf-ck" data-id="${esc(f.local_id)}"/></td>
            <td>${esc(_fmtTs(f.ts))}</td>
            <td>${esc(s.tanggal||'')}</td>
            <td>${esc(s.divisi_id||'')}</td>
            <td>${esc(_blokNameById(s.blok_id))}</td>
            <td>${esc(s.nik_mandor||'')}</td>
            <td class="num">${esc(f.attempts||1)}</td>
            <td style="color:var(--danger); max-width:280px; white-space:normal">${esc(f.error||'')}</td>
            <td class="aksi">
              <div class="cell-actions" style="display:flex; gap:6px; flex-wrap:wrap">
                <button data-retry="${esc(f.local_id)}" class="primary">Sinkron Ulang</button>
                <button data-edit="${esc(f.local_id)}">Edit</button>
                <button data-del="${esc(f.local_id)}" class="danger">Hapus</button>
              </div>
            </td>
          </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  // ck all
  const ckAll = $('#sf-ck-all');
  if (ckAll){
    ckAll.addEventListener('change', e=>{
      document.querySelectorAll('#sf-table .sf-ck').forEach(ck=>{ ck.checked = e.target.checked; });
    });
  }

  // tombol baris
  host.querySelectorAll('button[data-retry]').forEach(btn=>{
    btn.addEventListener('click', ()=> retry([btn.getAttribute('data-retry')]));
  });
  host.querySelectorAll('button[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-edit');
      sessionStorage.setItem('edit.local_id', id);
      location.hash = '#/input';
    });
  });
  host.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-del');
      await SyncFailures.clearOne(id);
      await reload(); renderSummary(); renderTable();
      showToast('Catatan dihapus dari log');
    });
  });
}

function selectedIds(){
  return Array.from(document.querySelectorAll('#sf-table .sf-ck:checked'))
    .map(x => x.getAttribute('data-id'));
}

// Sinkron ulang sekumpulan local_id (lewat endpoint bulk POST).
async function retry(localIds){
  const ids = (localIds || []).filter(Boolean);
  if (!ids.length){ showToast('Pilih data yang akan disinkron ulang'); return; }

  // ambil record terkini dari INPUT_RECORDS (mungkin sudah diedit)
  const all = (await IStore.getArr(Keys.INPUT_RECORDS).catch(()=>[])) || [];
  const map = new Map(all.map(r=>[String(r.local_id), r]));
  const records = ids.map(id => map.get(String(id))).filter(Boolean);

  if (!records.length){
    // record sudah tidak ada di lokal → bersihkan log saja
    await SyncFailures.clearMany(ids);
    await reload(); renderSummary(); renderTable();
    showToast('Data sumber tidak ditemukan; catatan dibersihkan');
    return;
  }

  Progress.open({ title:'Sinkron Ulang', subtitle:'Mengirim data…' });
  Progress.switchToDeterminate(records.length);
  try{
    const res = await API.syncBulk({ records, ..._auth() });
    if (!res || !res.ok || !res.data){
      throw new Error(res?.error || 'Sinkron ulang gagal');
    }
    const results = Array.isArray(res.data.results) ? res.data.results : [];
    const okIds = [];
    const stillFailed = [];
    results.forEach(rr=>{
      if (rr.ok) okIds.push(String(rr.local_id));
      else stillFailed.push({ local_id:String(rr.local_id), error: rr.error || 'Gagal di server' });
    });

    // tandai record sukses → synced di INPUT_RECORDS
    if (okIds.length){
      const set = new Set(okIds);
      const updated = all.map(r=> set.has(String(r.local_id)) ? { ...r, sync_status:'synced' } : r);
      await IStore.setArr(Keys.INPUT_RECORDS, updated);

      // keluarkan dari antrian sync
      const q = new Set((await IStore.getArr(Keys.SYNC_QUEUE).catch(()=>[])) || []);
      okIds.forEach(id=> q.delete(id));
      await IStore.setArr(Keys.SYNC_QUEUE, [...q]);

      await SyncFailures.clearMany(okIds);
    }

    // perbarui alasan utk yang masih gagal
    for (const f of stillFailed){
      const rec = map.get(String(f.local_id));
      if (rec) await SyncFailures.record(rec, f.error);
    }

    Progress.tick(records.length, records.length);
    if (stillFailed.length === 0) showToast(`Berhasil sinkron ulang: ${okIds.length} baris`);
    else if (okIds.length === 0)  showToast(`Masih gagal: ${stillFailed.length} baris`);
    else showToast(`Sebagian berhasil: ${okIds.length} sukses, ${stillFailed.length} masih gagal`);
  }catch(e){
    showToast(e.message || 'Sinkron ulang gagal');
  }finally{
    Progress.close();
    await reload(); renderSummary(); renderTable();
  }
}

function exportCSV(){
  const rows = SF.failures.slice().sort((a,b)=> (a.ts < b.ts ? 1 : -1));
  const header = ['waktu_gagal','tanggal','divisi','blok','nik_mandor','jjg','hk','tonase','percobaan','alasan','local_id'];
  const escCsv = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const lines = [ header.join(',') ];
  rows.forEach(f=>{
    const s = f.snapshot || {};
    lines.push([
      _fmtTs(f.ts), s.tanggal||'', s.divisi_id||'', _blokNameById(s.blok_id),
      s.nik_mandor||'', s.jjg||'', s.hk||'', s.tonase_ton||'',
      f.attempts||1, f.error||'', f.local_id||''
    ].map(escCsv).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gagal-sinkron-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function bind(){
  (async ()=>{
    await reload();
    renderSummary();
    renderTable();
  })().catch(console.warn);

  $('#sf-retry-all').addEventListener('click', ()=> retry(SF.failures.map(f=>f.local_id)));
  $('#sf-retry-selected').addEventListener('click', ()=> retry(selectedIds()));
  $('#sf-export').addEventListener('click', exportCSV);
  $('#sf-clear-all').addEventListener('click', async ()=>{
    if (!confirm('Bersihkan seluruh catatan gagal sinkron? (Data input tetap aman di lokal)')) return;
    await SyncFailures.clearAll();
    await reload(); renderSummary(); renderTable();
    showToast('Log gagal sinkron dibersihkan');
  });
}

export function render(app){ app.innerHTML = view(); bind(); }
