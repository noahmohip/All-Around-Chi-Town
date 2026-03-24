const admin = require('firebase-admin');

let db;

function getDb() {
  if (db) return db;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }

  db = admin.firestore();
  return db;
}

// ── Booked dates ─────────────────────────────────────────
async function blockDate(dateISO, bookingData = {}) {
  const db = getDb();
  await db.collection('booked_dates').doc(dateISO).set({
    date: dateISO,
    blockedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...bookingData,
  });
}

async function unblockDate(dateISO) {
  const db = getDb();
  await db.collection('booked_dates').doc(dateISO).delete();
}

async function getBookedDatesForMonth(year, month) {
  const db = getDb();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const snap = await db.collection('booked_dates')
    .where('date', '>=', prefix + '-01')
    .where('date', '<=', prefix + '-31')
    .get();
  const dates = [];
  snap.forEach(doc => dates.push(doc.data()));
  return dates;
}

// ── Bookings ────────────────────────────────────────────
async function saveBooking(bookingData) {
  const db = getDb();
  const ref = await db.collection('bookings').add({
    ...bookingData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function getAllBookings({ limit = 100, status } = {}) {
  const db = getDb();
  let q = db.collection('bookings').orderBy('createdAt', 'desc').limit(limit);
  if (status) q = q.where('status', '==', status);
  const snap = await q.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateBooking(id, data) {
  const db = getDb();
  await db.collection('bookings').doc(id).update(data);
}

// ── Waitlist ─────────────────────────────────────────────
async function addToWaitlist(dateISO, contactData) {
  const db = getDb();
  await db.collection('waitlist').add({
    date: dateISO,
    ...contactData,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
    notified: false,
  });
}

async function getWaitlistForDate(dateISO) {
  const db = getDb();
  const snap = await db.collection('waitlist')
    .where('date', '==', dateISO)
    .where('notified', '==', false)
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function markWaitlistNotified(ids) {
  const db = getDb();
  const batch = db.batch();
  ids.forEach(id => {
    batch.update(db.collection('waitlist').doc(id), { notified: true });
  });
  await batch.commit();
}

async function getAllWaitlist() {
  const db = getDb();
  const snap = await db.collection('waitlist')
    .orderBy('addedAt', 'desc')
    .limit(100)
    .get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

module.exports = {
  getDb, blockDate, unblockDate, getBookedDatesForMonth,
  saveBooking, getAllBookings, updateBooking,
  addToWaitlist, getWaitlistForDate, markWaitlistNotified, getAllWaitlist,
};
