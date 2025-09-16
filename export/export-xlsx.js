// =====================
// File: export/export-xlsx.js
// =====================
export function exportXLSX(rows, opts={}){
  if (!Array.isArray(rows)) rows = [];
  const headers = ['Tanggal','Divisi','Blok','Luas (Ha)','JJG','Br (kg)','HK','Tonase','Ton/HK','Ton/Ha'];

  const toRow = r => ([
    r.tanggal,
    r.divisi_id,
    r.blok_id,
    Number(r.luas_panen_ha||0),
    Number(r.jjg||0),
    Number(r.brondolan_kg||0),
    Number(r.hk||0),
    Number(r.tonase_ton||0),
    r.hk>0 ? +(r.tonase_ton/r.hk).toFixed(3) : 0,
    r.luas_panen_ha>0 ? +(r.tonase_ton/r.luas_panen_ha).toFixed(3) : 0
  ]);

  const body = rows.map(toRow);

  // Totals
  const sum = rows.reduce((a,r)=>({
    luas: a.luas + (Number(r.luas_panen_ha)||0),
    jjg:  a.jjg  + (Number(r.jjg)||0),
    br:   a.br   + (Number(r.brondolan_kg)||0),
    hk:   a.hk   + (Number(r.hk)||0),
    ton:  a.ton  + (Number(r.tonase_ton)||0),
  }), {luas:0,jjg:0,br:0,hk:0,ton:0});
  const thk = sum.hk>0 ? +(sum.ton/sum.hk).toFixed(3) : 0;
  const tha = sum.luas>0 ? +(sum.ton/sum.luas).toFixed(3) : 0;

  const totalRow = ['TOTAL','-','-', +sum.luas.toFixed(2), sum.jjg, +sum.br.toFixed(1), +sum.hk.toFixed(1), +sum.ton.toFixed(3), thk, tha];

  const data = [headers, ...body, totalRow];

  // Build workbook
  if (typeof XLSX === 'undefined'){ alert('XLSX library belum termuat'); return; }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Auto width
  ws['!cols'] = headers.map((h,i)=>{
    const colVals = data.map(row => (row[i] != null ? String(row[i]) : ''));
    const maxLen = Math.max(...colVals.map(v=>v.length), String(h).length);
    return { wch: Math.max(10, maxLen + 2) };
  });

  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Report');
  XLSX.writeFile(wb, opts.filename || `report_${Date.now()}.xlsx`);
}
