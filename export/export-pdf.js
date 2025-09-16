// =====================
// File: export/export-pdf.js
// =====================
export async function exportPDF(el, opts={}){
  const node = (typeof el === 'string') ? document.querySelector(el) : el;
  if (!node){ alert('Elemen report tidak ditemukan'); return; }
  if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined'){
    alert('html2canvas atau jsPDF belum termuat'); return;
  }

  // Render ke canvas
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/png');

  // PDF A4 portrait
  const pdf = new jspdf.jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;

  // Skala agar muat (fit-to-page)
  const ratio = Math.min(
    (pageW - margin*2) / canvas.width,
    (pageH - margin*2) / canvas.height
  );
  const imgW = canvas.width * ratio;
  const imgH = canvas.height * ratio;
  const x = (pageW - imgW)/2;
  const y = (pageH - imgH)/2;

  pdf.addImage(imgData, 'PNG', x, y, imgW, imgH);
  pdf.save(opts.filename || `report_${Date.now()}.pdf`);
}
