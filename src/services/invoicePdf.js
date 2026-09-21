import { jsPDF } from 'jspdf';

// =============================================================
// Geometra invoice PDF generator (jsPDF)
//
// Prints an A4 invoice with the Italian/European fiscal layout:
//   - seller block (cedente/prestatore)  -> art. 21 D.P.R. 633/1972
//   - customer block (cessionario/committente)
//   - itemised lines with quantities, unit prices, discounts and VAT
//   - VAT summary, optional stamp duty (imposta di bollo) and totals
//   - payment info, notes, page footer
//
// This is the "printable invoice" scope. Generating the FatturaPA XML
// (schema dl_fattura_v1.2.xsd) and submitting it to SdI is a FUTURE step;
// the seller/customer snapshot fields (vat_id, sdi_code, pec, tax_regime,
// vat_natura) exist precisely so that XML export can map onto them later.
// No legal/fiscal rule is invented here: rates, stamp duty and natura are
// always explicit user input, never auto-applied.
// =============================================================

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 14;

const formatEuro = (value, currency = 'EUR') =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(Number(value) || 0);

const formatDateISO = (value) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('it-IT');
};

const fetchAsDataUrl = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const clean = (value) => (value == null ? '' : String(value).trim());

const snapshotValue = (snapshot, key) => (snapshot && snapshot[key] != null ? snapshot[key] : '');

const sellerFrom = (invoice, profile) => {
  const snapshot = invoice && invoice.seller_snapshot;
  return {
    displayName: snapshotValue(snapshot, 'display_name') || (profile && profile.display_name) || '',
    legalName: snapshotValue(snapshot, 'legal_name') || (profile && profile.legal_name) || '',
    address: snapshotValue(snapshot, 'address') || (profile && profile.address) || '',
    city: snapshotValue(snapshot, 'city') || (profile && profile.city) || '',
    postalCode: snapshotValue(snapshot, 'postal_code') || (profile && profile.postal_code) || '',
    province: snapshotValue(snapshot, 'province') || (profile && profile.province) || '',
    country: snapshotValue(snapshot, 'country') || (profile && profile.country) || 'IT',
    vatId: snapshotValue(snapshot, 'vat_id') || (profile && profile.vat_id) || '',
    taxCode: snapshotValue(snapshot, 'tax_code') || (profile && profile.tax_code) || '',
    sdiCode: snapshotValue(snapshot, 'sdi_code') || (profile && profile.sdi_code) || '',
    pec: snapshotValue(snapshot, 'pec') || (profile && profile.pec) || '',
    phone: snapshotValue(snapshot, 'phone') || (profile && profile.phone) || '',
    email: snapshotValue(snapshot, 'email') || (profile && profile.email) || '',
  };
};

const customerFrom = (invoice) => {
  const snapshot = invoice && invoice.customer_snapshot;
  return {
    displayName: snapshotValue(snapshot, 'display_name'),
    legalName: snapshotValue(snapshot, 'legal_name'),
    address: snapshotValue(snapshot, 'address'),
    city: snapshotValue(snapshot, 'city'),
    postalCode: snapshotValue(snapshot, 'postal_code'),
    province: snapshotValue(snapshot, 'province'),
    country: snapshotValue(snapshot, 'country'),
    vatId: snapshotValue(snapshot, 'vat_id'),
    taxCode: snapshotValue(snapshot, 'tax_code'),
  };
};

const buildFooter = (doc, pageNumber, pageCount) => {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(130, 140, 152);
  doc.text('Geometra', MARGIN, FOOTER_Y);
  doc.text(String(pageNumber), PAGE_WIDTH - MARGIN - 8, FOOTER_Y, { align: 'right' });
  doc.text('/ ' + String(pageCount), PAGE_WIDTH - MARGIN, FOOTER_Y, { align: 'right' });
  doc.setDrawColor(228, 231, 235);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, FOOTER_Y - 4, PAGE_WIDTH - MARGIN, FOOTER_Y - 4);
};

export const generateInvoicePdf = async ({ invoice, items, seller, customer, logoUrl }) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'normal');

  const companyProfile = seller || sellerFrom(invoice, null);
  const customerData = customer || customerFrom(invoice);
  const logoDataUrl = logoUrl ? await fetchAsDataUrl(logoUrl) : null;

  // Header
  let cursorY = MARGIN + 8;

  if (logoDataUrl) {
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(MARGIN, cursorY - 12, 26, 26, 2, 2, 'FD');
    try {
      doc.addImage(logoDataUrl, logoDataUrl.includes('data:image/svg') ? 'PNG' : undefined, MARGIN + 2, cursorY - 10, 22, 22);
    } catch {
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Geometra', MARGIN + 13, cursorY + 1, { align: 'center' });
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text('Geometra', MARGIN, cursorY);
  }

  const right = PAGE_WIDTH - MARGIN;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('FATTURA', right, cursorY, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  const numberLine = `N. ${clean(invoice && invoice.invoice_number)}  ·  ${formatDateISO(invoice && invoice.invoice_date)}`;
  doc.text(numberLine, right, cursorY + 6, { align: 'right' });

  cursorY += 34;

  // Seller + Customer blocks
  const blockMax = (PAGE_WIDTH - MARGIN * 3) / 2; // ~90mm per block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('CEDENTE / PRESTATORE', MARGIN, cursorY);
  doc.text('CESSIONARIO / COMMITTENTE', MARGIN + blockMax + MARGIN, cursorY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);

  const sellerLines = [];
  const sellerHead = clean(companyProfile.displayName) || clean(companyProfile.legalName);
  if (sellerHead) sellerLines.push(sellerHead);
  const sellerLegal = clean(companyProfile.legalName);
  if (sellerLegal && sellerLegal !== sellerHead) sellerLines.push(sellerLegal);
  if (clean(companyProfile.address)) {
    sellerLines.push([
      clean(companyProfile.address),
      [clean(companyProfile.postalCode), clean(companyProfile.city), clean(companyProfile.province)]
        .filter(Boolean)
        .join(' '),
    ].filter(Boolean).join(', '));
  }
  if (clean(companyProfile.vatId)) sellerLines.push(`P.IVA ${clean(companyProfile.vatId)}`);
  if (clean(companyProfile.taxCode)) sellerLines.push(`C.F. ${clean(companyProfile.taxCode)}`);
  if (clean(companyProfile.sdiCode)) sellerLines.push(`SDI ${clean(companyProfile.sdiCode)}`);
  if (clean(companyProfile.pec)) sellerLines.push(`PEC ${clean(companyProfile.pec)}`);
  if (clean(companyProfile.phone)) sellerLines.push(clean(companyProfile.phone));
  if (clean(companyProfile.email)) sellerLines.push(`e-mail: ${clean(companyProfile.email)}`);

  const customerLines = [];
  const customerHead = clean(customerData.displayName) || clean(customerData.legalName);
  if (customerHead) customerLines.push(customerHead);
  const customerLegal = clean(customerData.legalName);
  if (customerLegal && customerLegal !== customerHead) customerLines.push(customerLegal);
  if (clean(customerData.address)) {
    customerLines.push([
      clean(customerData.address),
      [clean(customerData.postalCode), clean(customerData.city), clean(customerData.province)]
        .filter(Boolean)
        .join(' '),
    ].filter(Boolean).join(', '));
  }
  if (clean(customerData.vatId)) customerLines.push(`P.IVA ${clean(customerData.vatId)}`);
  if (clean(customerData.taxCode)) customerLines.push(`C.F. ${clean(customerData.taxCode)}`);

  let leftCursor = cursorY + 7;
  let rightCursor = cursorY + 7;

  for (const line of sellerLines) {
    const wrapped = doc.splitTextToSize(line, blockMax);
    for (const piece of wrapped) {
      doc.text(piece, MARGIN, leftCursor);
      leftCursor += 4.4;
    }
  }
  for (const line of customerLines) {
    const wrapped = doc.splitTextToSize(line, blockMax);
    for (const piece of wrapped) {
      doc.text(piece, MARGIN + blockMax + MARGIN, rightCursor);
      rightCursor += 4.4;
    }
  }

  cursorY = Math.max(leftCursor, rightCursor) + 10;

  // Items table
  const tableLeft = MARGIN;
  const tableRight = PAGE_WIDTH - MARGIN;
  const tableWidth = CONTENT_WIDTH;
  const columns = [
    { label: 'Descrizione', width: tableWidth - 16 - 18 - 22 - 18 - 26 },
    { label: 'Q.tà', width: 16, align: 'right' },
    { label: 'Prezzo unit.', width: 22, align: 'right' },
    { label: 'Sconto %', width: 18, align: 'right' },
    { label: 'IVA %', width: 18, align: 'right' },
    { label: 'Imponibile', width: 26, align: 'right' },
  ];
  // Ensure the description column is never negative
  const descWidth = columns[0].width;
  columns[0].width = descWidth;

  const tableHeaderY = cursorY;
  doc.setFillColor(241, 245, 249);
  doc.rect(tableLeft, tableHeaderY - 5.2, tableWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  let xCursor = tableLeft;
  for (const column of columns) {
    doc.text(column.label, column.align === 'right' ? xCursor + column.width - 1 : xCursor + 1, tableHeaderY, column.align === 'right' ? { align: 'right' } : { align: 'left' });
    xCursor += column.width;
  }

  cursorY = tableHeaderY + 5;

  const pageBottomLimit = FOOTER_Y - 14;

  const drawRow = (item) => {
    const descLines = doc.splitTextToSize(item.description || '\u00A0', columns[0].width - 2);
    const rowHeight = Math.max(6.5, descLines.length * 4.4 + 2.4);
    if (cursorY + rowHeight > pageBottomLimit) {
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.setFillColor(241, 245, 249);
      doc.rect(tableLeft, MARGIN - 5.2, tableWidth, 7, 'F');
      let headX = tableLeft;
      for (const column of columns) {
        doc.text(column.label, column.align === 'right' ? headX + column.width - 1 : headX + 1, MARGIN, column.align === 'right' ? { align: 'right' } : { align: 'left' });
        headX += column.width;
      }
      cursorY = MARGIN + 5;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);

    const discountLabel = Number(item.discount_percent) > 0 ? String(Number(item.discount_percent).toFixed(2)).replace(/\.?0+$/, '') : '';
    const vatLabel = item.vatNatura ? item.vatNatura : String(Number(item.vatRate || 0).toFixed(2)).replace(/\.?0+$/, '');

    let rowX = tableLeft;
    let lineY = cursorY + descLines.length * 4.4 - 1;
    doc.text(descLines, rowX + 1, cursorY + 3);
    rowX += columns[0].width;
    doc.text(formatQuantity(item.quantity), rowX + columns[1].width - 1, lineY, { align: 'right' });
    rowX += columns[1].width;
    doc.text(formatEuro(item.unit_price ?? item.unitPrice), rowX + columns[2].width - 1, lineY, { align: 'right' });
    rowX += columns[2].width;
    doc.text(discountLabel, rowX + columns[3].width - 1, lineY, { align: 'right' });
    rowX += columns[3].width;
    doc.text(vatLabel, rowX + columns[4].width - 1, lineY, { align: 'right' });
    rowX += columns[4].width;
    doc.text(formatEuro(item.lineSubtotalAv), rowX + columns[5].width - 1, lineY, { align: 'right' });

    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(tableLeft, cursorY + rowHeight, tableRight, cursorY + rowHeight);
    cursorY += rowHeight;
  };

  const formatQuantity = (value) => {
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
    return String(Number(value).toFixed(2)).replace(/\.?0+$/, '');
  };

  // Precompute totals per line (mirror invoiceService.computeLineTotals)
  const preparedRows = (items || []).map((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const gross = quantity * unitPrice;
    const discountPercent = Number(item.discount_percent) || 0;
    const discountAmount = Math.round((Number(item.discount_amount) || (gross * discountPercent) / 100) * 100) / 100;
    const lineSubtotal = Math.round((gross - discountAmount) * 100) / 100;
    const vatRate = item.vat_rate == null ? 0 : Number(item.vat_rate);
    const lineVat = Math.round((lineSubtotal * vatRate) / 100 * 100) / 100;
    const lineTotal = Math.round((lineSubtotal + lineVat) * 100) / 100;
    return { ...item, lineSubtotalAv: lineSubtotal, lineTotalAv: lineTotal, vatRate, discountAmount };
  });

  if (preparedRows.length === 0 && (Number(invoice && invoice.amount) || 0) > 0) {
    preparedRows.push({
      description: 'Servizi / Servizi professionali',
      quantity: 1,
      unit_price: Number(invoice.amount) || 0,
      unitPrice: Number(invoice.amount) || 0,
      discountAmount: 0,
      discount_percent: 0,
      vatRate: 0,
      lineSubtotalAv: Number(invoice.amount) || 0,
      lineTotalAv: Number(invoice.amount) || 0,
    });
  }

  for (const row of preparedRows) {
    drawRow(row);
  }

  // Totals block
  const subtotal = Math.round((preparedRows.reduce((s, r) => s + (Number(r.lineSubtotalAv) || 0), 0)) * 100) / 100;
  const discountTotal = Math.round((preparedRows.reduce((s, r) => s + (Number(r.discountAmount) || 0), 0)) * 100) / 100;
  const vatTotal = Math.round((preparedRows.reduce((s, r) => s + (Number(r.lineVat) || 0), 0)) * 100) / 100;
  const stampDuty = Number(invoice && invoice.stamp_duty) || 0;
  const grandTotal = Math.round((subtotal + vatTotal + stampDuty) * 100) / 100;

  const totalBlockX = tableRight - 70;
  const totalBlockWidth = 70;

  cursorY += 8;

  const drawTotalRow = (label, value, { bold = false, fontSize = 12 } = {}) => {
    if (cursorY > pageBottomLimit - 4) {
      doc.addPage();
      cursorY = MARGIN + 10;
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(15, 23, 42);
    doc.text(label, totalBlockX, cursorY);
    doc.text(value, totalBlockX + totalBlockWidth, cursorY, { align: 'right' });
    cursorY += bold ? 8 : 5.5;
  };

  drawTotalRow('Imponibile', formatEuro(subtotal));
  if (discountTotal > 0) drawTotalRow('Sconti totali', `- ${formatEuro(discountTotal)}`);
  if (vatTotal > 0) {
    const totalsByRate = {};
    for (const row of preparedRows) {
      if ((Number(row.vatRate) || 0) > 0 && row.lineVat > 0) {
        const key = Number(row.vatRate).toFixed(2).replace(/\.?0+$/, '') + '%';
        totalsByRate[key] = (totalsByRate[key] || 0) + (Number(row.lineVat) || 0);
      }
    }
    Object.keys(totalsByRate)
      .sort()
      .forEach((rate) => drawTotalRow(`IVA ${rate}`, formatEuro(Math.round(totalsByRate[rate] * 100) / 100)));
  }
  if (stampDuty > 0) drawTotalRow('Imposta di bollo', formatEuro(stampDuty));
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(totalBlockX, cursorY - 2, totalBlockX + totalBlockWidth, cursorY - 2);
  drawTotalRow('Totale fattura', formatEuro(grandTotal), { bold: true });

  // Payment info + notes
  if (invoice && (invoice.payment_terms || invoice.payment_method || invoice.payment_reference || invoice.due_date)) {
    cursorY += 6;
    if (cursorY > pageBottomLimit - 30) {
      doc.addPage();
      cursorY = MARGIN + 10;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('PAGAMENTO', MARGIN, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    cursorY += 5;
    if (invoice.due_date) {
      doc.text(`Scadenza: ${formatDateISO(invoice.due_date)}`, MARGIN, cursorY);
      cursorY += 4.6;
    }
    if (invoice.payment_terms) {
      const wrapped = doc.splitTextToSize(`Condizioni: ${invoice.payment_terms}`, CONTENT_WIDTH - 20);
      for (const piece of wrapped) {
        doc.text(piece, MARGIN, cursorY);
        cursorY += 4.4;
      }
    }
    if (invoice.payment_method) {
      doc.text(`Modalità: ${invoice.payment_method}`, MARGIN, cursorY);
      cursorY += 4.6;
    }
    if (invoice.payment_reference) {
      doc.text(`Riferimento: ${invoice.payment_reference}`, MARGIN, cursorY);
      cursorY += 4.6;
    }
  }

  if (invoice && invoice.notes) {
    cursorY += 4;
    if (cursorY > pageBottomLimit - 20) {
      doc.addPage();
      cursorY = MARGIN + 10;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('NOTE', MARGIN, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 41, 59);
    const noteLines = doc.splitTextToSize(invoice.notes, CONTENT_WIDTH - 30);
    for (const piece of noteLines.slice(0, 8)) {
      cursorY += 4.6;
      doc.text(piece, MARGIN, cursorY);
    }
  }

  // Footers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    buildFooter(doc, i, pageCount);
  }

  return doc;
};

export const downloadInvoicePdf = async (input, fileName) => {
  const doc = await generateInvoicePdf(input);
  doc.save(fileName || `fattura-${input.invoice && input.invoice.invoice_number || ''}.pdf`);
};

export const openInvoicePdf = async (input, fileName) => {
  const doc = await generateInvoicePdf(input);
  const blobUrl = doc.output('bloburl');
  const a = document.createElement('a');
  a.href = blobUrl;
  a.target = '_blank';
  a.rel = 'noopener';
  a.download = fileName || `fattura-${input.invoice && input.invoice.invoice_number || ''}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};