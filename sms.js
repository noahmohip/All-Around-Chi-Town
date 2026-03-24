const twilio = require('twilio');

let client;

function getClient() {
  if (!client) {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return client;
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

// ── Send a single SMS ────────────────────────────────────
async function sendSMS(to, body) {
  try {
    const msg = await getClient().messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    console.log(`SMS sent to ${to}: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error('SMS error:', err.message);
    // Don't throw — SMS failure shouldn't break the booking flow
  }
}

// ── Customer confirmation SMS ────────────────────────────
async function sendCustomerConfirmation({ phone, name, date, packageName, depositAmount }) {
  if (!phone) return;
  const dateStr = formatDate(date);
  const body =
    `Hi ${name.split(' ')[0]}! 🎉 Your All Around Chi-Town 360 booth is CONFIRMED for ${dateStr}.\n\n` +
    `Package: ${packageName}\n` +
    `Deposit paid: $${depositAmount}\n` +
    `Balance due day-of event.\n\n` +
    `Questions? Reply to this text or email bookings@allaroundchitown.com\n` +
    `– All Around Chi-Town 🎬`;
  return sendSMS(phone, body);
}

// ── Owner notification SMS ───────────────────────────────
async function sendOwnerNotification({ name, phone, email, date, packageName, depositAmount }) {
  const dateStr = formatDate(date);
  const body =
    `💰 NEW BOOKING — All Around Chi-Town\n\n` +
    `Client: ${name}\n` +
    `Phone: ${phone || 'Not provided'}\n` +
    `Email: ${email}\n` +
    `Date: ${dateStr}\n` +
    `Package: ${packageName}\n` +
    `Deposit: $${depositAmount}\n\n` +
    `Date has been blocked on your calendar ✅`;
  return sendSMS(process.env.OWNER_PHONE_NUMBER, body);
}

// ── Waitlist notification SMS ────────────────────────────
async function sendWaitlistNotification({ phone, name, date }) {
  if (!phone) return;
  const dateStr = formatDate(date);
  const body =
    `Hi ${name.split(' ')[0]}! Great news — ${dateStr} just opened up on your All Around Chi-Town waitlist! 🎉\n\n` +
    `Book now before it's gone → allaroundchitown.com\n` +
    `– All Around Chi-Town`;
  return sendSMS(phone, body);
}

// ── Inquiry confirmation SMS ─────────────────────────────
async function sendInquiryConfirmation({ phone, name }) {
  if (!phone) return;
  const body =
    `Hi ${name.split(' ')[0]}! We got your inquiry and will get back to you within 24 hours. 📲\n` +
    `– All Around Chi-Town`;
  return sendSMS(phone, body);
}

module.exports = {
  sendSMS,
  sendCustomerConfirmation,
  sendOwnerNotification,
  sendWaitlistNotification,
  sendInquiryConfirmation,
};
