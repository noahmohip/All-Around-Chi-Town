const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

// ── Customer booking confirmation email with PDF invoice ──
async function sendBookingConfirmation(booking, invoicePdfBuffer) {
  const dateStr = formatDate(booking.eventDate);
  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"><style>
    body { font-family: Arial, sans-serif; background: #f5f4f2; margin: 0; padding: 0; }
    .wrap { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: #090909; padding: 40px 40px 30px; }
    .header h1 { color: #c9a84c; font-size: 22px; margin: 0 0 4px; letter-spacing: 2px; }
    .header p { color: #7a7570; font-size: 12px; margin: 0; letter-spacing: 1px; }
    .gold-bar { height: 3px; background: #c9a84c; }
    .body { padding: 40px; }
    .greeting { font-size: 18px; color: #090909; font-weight: bold; margin-bottom: 12px; }
    .body p { color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
    .details-box { background: #fdf8ed; border-left: 3px solid #c9a84c; padding: 20px 24px; margin: 24px 0; }
    .details-box table { width: 100%; border-collapse: collapse; }
    .details-box td { padding: 6px 0; font-size: 13px; }
    .details-box td:first-child { color: #7a7570; width: 40%; }
    .details-box td:last-child { color: #090909; font-weight: bold; }
    .cta-btn { display: inline-block; background: #c9a84c; color: #090909; padding: 14px 32px;
               text-decoration: none; font-weight: bold; font-size: 13px; letter-spacing: 2px;
               text-transform: uppercase; margin: 8px 0; }
    .footer { background: #090909; padding: 28px 40px; text-align: center; }
    .footer p { color: #7a7570; font-size: 11px; margin: 4px 0; }
    .footer a { color: #c9a84c; text-decoration: none; }
  </style></head>
  <body>
  <div class="wrap">
    <div class="header">
      <h1>ALL AROUND CHI-TOWN</h1>
      <p>360 DEGREES OF FUN · CHICAGO, IL</p>
    </div>
    <div class="gold-bar"></div>
    <div class="body">
      <div class="greeting">🎉 You're booked, ${booking.customerName?.split(' ')[0]}!</div>
      <p>Your All Around Chi-Town 360° photo booth is officially confirmed. Get ready for the most talked-about moment at your event.</p>
      <div class="details-box">
        <table>
          <tr><td>Event Date</td><td>${dateStr}</td></tr>
          <tr><td>Event Type</td><td>${booking.eventType || '—'}</td></tr>
          <tr><td>Package</td><td>${booking.packageName}</td></tr>
          <tr><td>Deposit Paid</td><td>$${(booking.depositAmount / 100).toFixed(2)}</td></tr>
          <tr><td>Balance Due</td><td>Day of event (before setup)</td></tr>
        </table>
      </div>
      <p>Your invoice is attached to this email for your records. The remaining balance is due on the day of the event before we begin setup.</p>
      <p><strong>What happens next:</strong><br>
      We'll reach out 48 hours before your event to confirm setup time and location. Please ensure a clear 10×10ft space is available.</p>
      <p>Have questions? Reply to this email or text us any time.</p>
    </div>
    <div class="footer">
      <p><a href="mailto:bookings@allaroundchitown.com">bookings@allaroundchitown.com</a></p>
      <p><a href="https://allaroundchitown.com">allaroundchitown.com</a> · <a href="https://tiktok.com/@allaroundchitown">@allaroundchitown</a></p>
    </div>
  </div>
  </body></html>
  `;

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: booking.customerEmail,
    subject: `✦ Booking Confirmed — ${dateStr} · All Around Chi-Town`,
    html,
    attachments: invoicePdfBuffer ? [{
      filename: `AllAroundChiTown_Invoice_${booking.eventDate}.pdf`,
      content: invoicePdfBuffer,
      contentType: 'application/pdf',
    }] : [],
  });
}

// ── Owner notification email ──────────────────────────────
async function sendOwnerNotification(booking) {
  const dateStr = formatDate(booking.eventDate);
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:500px;padding:24px;background:#f5f4f2;">
    <h2 style="color:#c9a84c;margin:0 0 16px;">💰 New Booking!</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="color:#7a7570;padding:6px 0;width:40%;">Client</td><td style="font-weight:bold;">${booking.customerName}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Email</td><td>${booking.customerEmail}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Phone</td><td>${booking.customerPhone || 'Not provided'}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Event Date</td><td style="font-weight:bold;color:#c9a84c;">${dateStr}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Event Type</td><td>${booking.eventType}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Package</td><td style="font-weight:bold;">${booking.packageName}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Deposit</td><td style="color:green;font-weight:bold;">$${(booking.depositAmount / 100).toFixed(2)} received</td></tr>
    </table>
    <p style="color:#555;font-size:13px;margin-top:16px;">✅ The date has been automatically blocked on your calendar.</p>
  </div>
  `;

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_USER,
    subject: `💰 New Booking — ${booking.customerName} · ${dateStr}`,
    html,
  });
}

// ── Contact form inquiry notification ────────────────────
async function sendInquiryNotification(data) {
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:500px;padding:24px;background:#f5f4f2;">
    <h2 style="color:#c9a84c;margin:0 0 16px;">📩 New Inquiry</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="color:#7a7570;padding:6px 0;width:40%;">Name</td><td style="font-weight:bold;">${data.name}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Email</td><td>${data.email}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Phone</td><td>${data.phone || 'Not provided'}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Event Type</td><td>${data.eventType}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Event Date</td><td style="font-weight:bold;">${data.eventDate}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Package</td><td>${data.package}</td></tr>
      <tr><td style="color:#7a7570;padding:6px 0;">Message</td><td>${data.message || '—'}</td></tr>
    </table>
  </div>
  `;

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_USER,
    replyTo: data.email,
    subject: `📩 New Inquiry — ${data.name} · ${data.eventDate}`,
    html,
  });
}

// ── Waitlist availability notification ───────────────────
async function sendWaitlistEmail({ email, name, date }) {
  const dateStr = formatDate(date);
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `🎉 ${dateStr} just opened up — All Around Chi-Town`,
    html: `
    <div style="font-family:Arial,sans-serif;max-width:500px;padding:32px;background:#090909;">
      <h2 style="color:#c9a84c;">Great news, ${name.split(' ')[0]}!</h2>
      <p style="color:#f5f0ea;font-size:14px;line-height:1.7;">
        ${dateStr} just opened up on your All Around Chi-Town waitlist.<br><br>
        <strong style="color:#c9a84c;">Book now before it's gone →</strong>
      </p>
      <a href="https://allaroundchitown.com/#availability"
         style="display:inline-block;background:#c9a84c;color:#090909;padding:14px 28px;
                text-decoration:none;font-weight:bold;font-size:13px;letter-spacing:1px;
                text-transform:uppercase;margin-top:12px;">
        Book This Date
      </a>
      <p style="color:#7a7570;font-size:11px;margin-top:24px;">
        All Around Chi-Town · bookings@allaroundchitown.com
      </p>
    </div>
    `,
  });
}

module.exports = {
  sendBookingConfirmation,
  sendOwnerNotification,
  sendInquiryNotification,
  sendWaitlistEmail,
};
