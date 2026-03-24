const PDFDocument = require('pdfkit');

const GOLD = '#C9A84C';
const BLACK = '#090909';
const DARK = '#1A1917';
const GRAY = '#7A7570';
const WHITE = '#F5F0EA';

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

function formatCurrency(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Generates a PDF invoice and returns it as a Buffer
 */
function generateInvoice(booking) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 60,
      info: {
        Title: `Invoice — All Around Chi-Town`,
        Author: 'All Around Chi-Town',
      },
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 60;
    const contentW = pageW - margin * 2;

    // ── DARK HEADER BANNER ──────────────────────────────
    doc.rect(0, 0, pageW, 140).fill(BLACK);

    // Gold left accent bar
    doc.rect(0, 0, 4, 140).fill(GOLD);

    // Company name
    doc.fillColor(GOLD)
       .font('Helvetica-Bold')
       .fontSize(22)
       .text('ALL AROUND CHI-TOWN', margin, 38, { characterSpacing: 2 });

    doc.fillColor(WHITE)
       .font('Helvetica')
       .fontSize(9)
       .text('360 DEGREES OF FUN  ·  CHICAGO, IL', margin, 65, { characterSpacing: 1.5 });

    // INVOICE label top right
    doc.fillColor(GOLD)
       .font('Helvetica-Bold')
       .fontSize(28)
       .text('INVOICE', pageW - margin - 120, 38, { width: 120, align: 'right', characterSpacing: 3 });

    // Invoice meta top right
    doc.fillColor(WHITE)
       .font('Helvetica')
       .fontSize(8);

    const invoiceNum = booking.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
    const issuedDate = formatDate(new Date().toISOString().split('T')[0]);

    doc.text(`Invoice #: ${invoiceNum}`, margin, 95, { width: contentW, align: 'right' });
    doc.text(`Date Issued: ${issuedDate}`, margin, 108, { width: contentW, align: 'right' });

    // ── BILL TO / EVENT DETAILS ─────────────────────────
    let y = 170;

    // Two columns
    const col1X = margin;
    const col2X = pageW / 2 + 20;
    const colW  = pageW / 2 - margin - 20;

    // Section label style
    function sectionLabel(text, x, yPos) {
      doc.fillColor(GOLD)
         .font('Helvetica-Bold')
         .fontSize(7)
         .text(text, x, yPos, { characterSpacing: 2 });
      doc.moveTo(x, yPos + 12).lineTo(x + colW, yPos + 12).stroke(GOLD);
      return yPos + 18;
    }

    function detailRow(label, value, x, yPos, opts = {}) {
      doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(label, x, yPos);
      doc.fillColor(opts.highlight ? GOLD : BLACK)
         .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(9)
         .text(value || '—', x, yPos + 11);
      return yPos + 28;
    }

    // Bill To
    y = sectionLabel('BILL TO', col1X, y);
    y = detailRow('Client Name', booking.customerName, col1X, y, { bold: true });
    y = detailRow('Email', booking.customerEmail, col1X, y);
    y = detailRow('Phone', booking.customerPhone || 'Not provided', col1X, y);

    // Event Details
    let y2 = 170;
    y2 = sectionLabel('EVENT DETAILS', col2X, y2);
    y2 = detailRow('Event Date', formatDate(booking.eventDate), col2X, y2, { bold: true, highlight: true });
    y2 = detailRow('Event Type', booking.eventType, col2X, y2);
    y2 = detailRow('Package', booking.packageName, col2X, y2, { bold: true });

    y = Math.max(y, y2) + 20;

    // ── LINE ITEMS TABLE ────────────────────────────────
    // Header row
    doc.rect(margin, y, contentW, 26).fill(BLACK);
    doc.rect(margin, y, 3, 26).fill(GOLD);

    const cols = {
      desc:  { x: margin + 12, w: contentW * 0.55 },
      qty:   { x: margin + contentW * 0.55, w: contentW * 0.12 },
      unit:  { x: margin + contentW * 0.67, w: contentW * 0.16 },
      total: { x: margin + contentW * 0.83, w: contentW * 0.17 },
    };

    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(7);
    doc.text('DESCRIPTION', cols.desc.x, y + 9, { characterSpacing: 1.5 });
    doc.text('QTY', cols.qty.x, y + 9, { width: cols.qty.w, align: 'center', characterSpacing: 1 });
    doc.text('UNIT PRICE', cols.unit.x, y + 9, { width: cols.unit.w, align: 'right', characterSpacing: 1 });
    doc.text('TOTAL', cols.total.x, y + 9, { width: cols.total.w, align: 'right', characterSpacing: 1 });

    y += 26;

    // Line items
    const packagePrice = booking.packageName?.includes('4 Hour') ? 60000 : 30000;
    const depositCents = booking.depositAmount || 10000;
    const balanceCents = packagePrice - depositCents;

    const lineItems = [
      { desc: booking.packageName || '360° Photo Booth Rental', qty: 1, unit: packagePrice },
      ...(booking.addons || []).map(a => ({ desc: a.name, qty: 1, unit: a.priceCents })),
    ];

    let rowY = y;
    lineItems.forEach((item, i) => {
      const bg = i % 2 === 0 ? '#F9F7F3' : '#FFFFFF';
      doc.rect(margin, rowY, contentW, 26).fill(bg);
      doc.rect(margin, rowY, 3, 26).fill(i % 2 === 0 ? GOLD : '#D4B863');

      doc.fillColor(BLACK).font('Helvetica').fontSize(9);
      doc.text(item.desc, cols.desc.x, rowY + 8, { width: cols.desc.w - 10 });
      doc.text(String(item.qty), cols.qty.x, rowY + 8, { width: cols.qty.w, align: 'center' });
      doc.text(formatCurrency(item.unit), cols.unit.x, rowY + 8, { width: cols.unit.w, align: 'right' });
      doc.fillColor(BLACK).font('Helvetica-Bold');
      doc.text(formatCurrency(item.unit * item.qty), cols.total.x, rowY + 8, { width: cols.total.w, align: 'right' });

      rowY += 26;
    });

    y = rowY + 10;

    // ── TOTALS ──────────────────────────────────────────
    const totalsX = pageW / 2;
    const totalsW = pageW / 2 - margin;

    function totalRow(label, value, yPos, opts = {}) {
      if (opts.highlight) {
        doc.rect(totalsX, yPos, totalsW, 32).fill(BLACK);
        doc.rect(totalsX, yPos, 3, 32).fill(GOLD);
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10);
        doc.text(label, totalsX + 12, yPos + 10, { width: totalsW * 0.5 });
        doc.text(value, totalsX + 12, yPos + 10, { width: totalsW - 12, align: 'right' });
        return yPos + 32;
      }
      doc.rect(totalsX, yPos, totalsW, 24).fill(opts.bold ? '#F0EBE0' : '#F9F7F3');
      doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(label, totalsX + 12, yPos + 7);
      doc.fillColor(opts.paid ? '#2d6a0f' : BLACK)
         .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(9)
         .text(value, totalsX + 12, yPos + 7, { width: totalsW - 12, align: 'right' });
      return yPos + 24;
    }

    const subtotal = lineItems.reduce((s, i) => s + i.unit * i.qty, 0);
    y = totalRow('SUBTOTAL', formatCurrency(subtotal), y);
    y = totalRow(`DEPOSIT PAID (${booking.paymentDate || issuedDate})`, `– ${formatCurrency(depositCents)}`, y, { paid: true });
    y = totalRow('BALANCE DUE (Day of Event)', formatCurrency(balanceCents), y, { bold: true });
    y = totalRow('TOTAL', formatCurrency(subtotal), y, { highlight: true });

    // ── PAYMENT STATUS BADGE ────────────────────────────
    y += 16;
    doc.rect(margin, y, 120, 28).fill('#E8F5E0');
    doc.rect(margin, y, 3, 28).fill('#4CAF50');
    doc.fillColor('#2d6a0f').font('Helvetica-Bold').fontSize(8)
       .text('✓  DEPOSIT RECEIVED', margin + 10, y + 10, { characterSpacing: 1 });

    // ── NOTES ───────────────────────────────────────────
    y += 50;
    doc.rect(margin, y, contentW, 1).fill('#E8E0D0');
    y += 12;

    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(7)
       .text('NOTES & TERMS', margin, y, { characterSpacing: 2 });
    y += 16;

    const notes = [
      `• Balance of ${formatCurrency(balanceCents)} is due in full on the day of the event before setup begins.`,
      '• Cancellations 7+ days before the event: full deposit refund.',
      '• Cancellations within 7 days: deposit non-refundable but transferable within 60 days.',
      '• Please ensure a 10x10ft minimum clear area is available for booth setup.',
      '• Thank you for choosing All Around Chi-Town — we can\'t wait to make your event unforgettable! 🎬',
    ];

    doc.fillColor(GRAY).font('Helvetica').fontSize(8);
    notes.forEach(note => {
      doc.text(note, margin, y, { width: contentW });
      y += 14;
    });

    // ── FOOTER ──────────────────────────────────────────
    doc.rect(0, pageH - 50, pageW, 50).fill(BLACK);
    doc.rect(0, pageH - 50, 4, 50).fill(GOLD);

    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8)
       .text('ALL AROUND CHI-TOWN', margin, pageH - 36, { characterSpacing: 1.5 });
    doc.fillColor(WHITE).font('Helvetica').fontSize(7)
       .text('bookings@allaroundchitown.com  ·  allaroundchitown.com  ·  @allaroundchitown', margin, pageH - 22);

    doc.fillColor(GRAY).font('Helvetica').fontSize(7)
       .text(`Invoice ${invoiceNum}`, 0, pageH - 22, { width: pageW - margin, align: 'right' });

    doc.end();
  });
}

module.exports = { generateInvoice };
