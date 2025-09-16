// /assets/js/features/master.js
import { API } from '../core/api.js';
import { Auth } from '../core/auth.js';
import { Storage } from '../core/storage.js';

// ----- util render: bangun <thead> + <tbody> penuh -----
function renderPreview(sel, rows){
  const el = document.querySelector(sel);
  if (!el) return;
  if (!rows?.length){
    el.innerHTML = '<tbody><tr><td class="text-muted">Tidak ada data</td></tr></tbody>';
    return;
  }
  const cols = Object.keys(rows[0]);
  el.innerHTML =
    `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

let parsed = { blocks: [], holidays: [] };

// ----- parse XLSX (BLOCKS & HOLIDAYS) -----
async function parseXlsx(file){
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type:'array' });
  const wsB = wb.Sheets['BLOCKS'];
  const wsH = wb.Sheets['HOLIDAYS'];
  if (!wsB) throw new Error('Sheet "BLOCKS" tidak ditemukan');
  if (!wsH) throw new Error('Sheet "HOLIDAYS" tidak ditemukan');

  const now = new Date().toISOString();
  const blocksRaw   = XLSX.utils.sheet_to_json(wsB, { defval:'' });
  const holidaysRaw = XLSX.utils.sheet_to_json(wsH, { defval:'' });

  const blocks = blocksRaw.map(r=>({
    block_code: String(r.block_code ?? r.BLOCK_CODE ?? '').trim(),
    luas      : Number(r.luas ?? r.LUAS ?? 0),
    kadvel    : String(r.kadvel ?? r.KADVEL ?? '').trim(),
    aktif     : String(r.aktif ?? r.AKTIF ?? 'true').toLowerCase() !== 'false',
    updated_at: now
  })).filter(r=> r.block_code);

  const holidays = holidaysRaw.map(r=>({
    date      : String(r.date ?? r.tanggal ?? '').slice(0,10),
    note      : String(r.note ?? r.keterangan ?? ''),
    updated_at: now
  })).filter(r=> r.date);

  parsed = { blocks, holidays };

  // simpan sementara (agar export/report bisa pakai)
  Storage.set('pp:blocks', blocks);
  Storage.set('pp:holidays', holidays);

  // preview
  renderPreview('#as-blocks-table',   blocks);
  renderPreview('#as-holidays-table', holidays);

  return parsed;
}

// ----- upload master ke GAS (endpoint: master.push) -----
// org opsional: jika ada, pakai org tersebut & simpan ke session/local
async function upload(org){
  Auth.guard(); const u = Auth.user();
  const targetOrg = org || u?.org;
  if (!targetOrg) throw new Error('Org wajib diisi (PT/Kebun/Divisi)');
  if ((!parsed.blocks?.length) && (!parsed.holidays?.length)) {
    throw new Error('Tidak ada data untuk diunggah');
  }

  const resp = await API.call('master.push', {
    token: u.token,
    org  : targetOrg,
    blocks : parsed.blocks,
    holidays: parsed.holidays
  });
  if (!resp.ok) throw new Error(resp.error || 'Upload master gagal');

  // simpan org ke session & local agar request selanjutnya otomatis
  const u2 = Auth.user(); u2.org = targetOrg;
  Storage.set('pp:user', u2);
  Storage.set('pp:org', targetOrg);

  return resp;
}

// ----- pull master dari GAS (endpoint: master.pull) -----
async function pullMaster(org){
  Auth.guard(); const u = Auth.user();
  const targetOrg = org || u?.org;
  if (!targetOrg) throw new Error('Org wajib diisi (PT/Kebun/Divisi)');

  const resp = await API.call('master.pull', { token: u.token, org: targetOrg });
  if (!resp.ok) throw new Error(resp.error || 'Pull master gagal');

  Storage.set('pp:blocks',   resp.blocks || []);
  Storage.set('pp:holidays', resp.holidays || []);

  // ingat org
  const u2 = Auth.user(); u2.org = targetOrg;
  Storage.set('pp:user', u2);
  Storage.set('pp:org', targetOrg);

  // preview
  renderPreview('#as-blocks-table',   resp.blocks || []);
  renderPreview('#as-holidays-table', resp.holidays || []);

  return resp;
}

// ----- reset cache lokal (preview & storage) -----
function resetLocal(){
  parsed = { blocks: [], holidays: [] };
  Storage.remove('pp:blocks');
  Storage.remove('pp:holidays');
  renderPreview('#as-blocks-table',   []);
  renderPreview('#as-holidays-table', []);
}

// ----- bonus: unduh template XLSX untuk user -----
function downloadTemplate(){
  const wb = XLSX.utils.book_new();
  const wsBlocks   = XLSX.utils.aoa_to_sheet([
    ['block_code','luas','kadvel','aktif'],
    ['A-01', 8.5, 'KDV-1', true],
  ]);
  const wsHolidays = XLSX.utils.aoa_to_sheet([
    ['date','note'],
    ['2025-01-01','Tahun Baru'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsBlocks,   'BLOCKS');
  XLSX.utils.book_append_sheet(wb, wsHolidays, 'HOLIDAYS');
  XLSX.writeFile(wb, 'Template_Master.xlsx');
}

export const Master = { parseXlsx, upload, pullMaster, resetLocal, downloadTemplate };
