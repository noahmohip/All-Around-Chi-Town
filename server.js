require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt        = require('jsonwebtoken');
const firebase   = require('./services/firebase');
const sms        = require('./services/sms');
const email      = require('./services/email');
const { generateInvoice } = require('./services/invoice');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── CORS ─────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:5500', // Live Server
    /\.netlify\.app$/,
  ],
  credentials: true,
}));

// ── RAW BODY for Stripe webhooks (must be before json()) ──
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// ── JSON for everything else ──────────────────────────────
app.use(express.json());

// ── AUTH MIDDLEWARE ───────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── HEALTH CHECK ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'All Around Chi-Town API', ts: new Date().toISOString() });
});

// ╔══════════════════════════════════════════════════════════╗
// ║  AVAILABILITY                                           ║
// ╚══════════════════════════════════════════════════════════╝

// GET /api/availability?year=2025&month=6
app.get('/api/availability', async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const dates = await firebase.getBookedDatesForMonth(year, month);
    res.json({ bookedDates: dates.map(d => d.date) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// POST /api/availability/block  (admin only)
app.post('/api/availability/block', requireAdmin, async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'Date required' });
    await firebase.blockDate(date, { reason: reason || 'Admin blocked', type: 'manual' });
    res.json({ success: true, date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/availability/block/:date  (admin only)
app.delete('/api/availability/block/:date', requireAdmin, async (req, res) => {
  try {
    await firebase.unblockDate(req.params.date);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ╔══════════════════════════════════════════════════════════╗
// ║  STRIPE CHECKOUT                                        ║
// ╚══════════════════════════════════════════════════════════╝

// POST /api/create-checkout
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { firstName, lastName, email: custEmail, phone,
            eventType, eventDate, packageName, message, addons } = req.body;

    if (!firstName || !custEmail || !eventDate || !packageName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check the date isn't already booked
    const year  = parseInt(eventDate.split('-')[0]);
    const month = parseInt(eventDate.split('-')[1]);
    const booked = await firebase.getBookedDatesForMonth(year, month);
    if (booked.some(d => d.date === eventDate)) {
      return res.status(409).json({ error: 'This date is already booked. Please choose another date.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: parseInt(process.env.DEPOSIT_AMOUNT_CENTS) || 10000,
          product_data: {
            name: `All Around Chi-Town — Deposit · ${packageName}`,
            description: `Event date: ${eventDate} · ${eventType}`,
            images: ['https://allaroundchitown.com/logo.png'],
          },
        },
        quantity: 1,
      }],
      customer_email: custEmail,
      metadata: {
        firstName, lastName,
        phone: phone || '',
        eventType, eventDate,
        packageName, message: message || '',
        addons: JSON.stringify(addons || []),
      },
      success_url: `${process.env.FRONTEND_URL}/?booking=success&date=${eventDate}`,
      cancel_url:  `${process.env.FRONTEND_URL}/?booking=cancelled`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ╔══════════════════════════════════════════════════════════╗
// ║  STRIPE WEBHOOK — fires after deposit paid              ║
// ╚══════════════════════════════════════════════════════════╝

app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook sig failed:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta    = session.metadata;

    const booking = {
      stripeSessionId:  session.id,
      customerName:     `${meta.firstName} ${meta.lastName}`,
      customerEmail:    session.customer_email,
      customerPhone:    meta.phone,
      eventDate:        meta.eventDate,
      eventType:        meta.eventType,
      packageName:      meta.packageName,
      message:          meta.message,
      addons:           JSON.parse(meta.addons || '[]'),
      depositAmount:    session.amount_total,
      paymentDate:      new Date().toISOString().split('T')[0],
      invoiceNumber:    `INV-${Date.now().toString().slice(-8)}`,
      status:           'confirmed',
    };

    console.log(`✅ Payment confirmed for ${booking.customerName} on ${booking.eventDate}`);

    // Run all post-payment actions in parallel
    const actions = await Promise.allSettled([
      // 1. Block the date in Firebase
      firebase.blockDate(booking.eventDate, {
        type: 'booking',
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        packageName: booking.packageName,
      }),

      // 2. Save full booking record
      firebase.saveBooking(booking),

      // 3. Generate PDF invoice + send confirmation email
      (async () => {
        const pdf = await generateInvoice(booking);
        await email.sendBookingConfirmation(booking, pdf);
      })(),

      // 4. Send owner notification email
      email.sendOwnerNotification(booking),

      // 5. SMS customer
      sms.sendCustomerConfirmation({
        phone:         booking.customerPhone,
        name:          booking.customerName,
        date:          booking.eventDate,
        packageName:   booking.packageName,
        depositAmount: booking.depositAmount / 100,
      }),

      // 6. SMS owner
      sms.sendOwnerNotification({
        name:          booking.customerName,
        phone:         booking.customerPhone,
        email:         booking.customerEmail,
        date:          booking.eventDate,
        packageName:   booking.packageName,
        depositAmount: booking.depositAmount / 100,
      }),

      // 7. Notify waitlist
      (async () => {
        const waitlist = await firebase.getWaitlistForDate(booking.eventDate);
        if (!waitlist.length) return;
        // Date is now booked, so notify the waitlist this date is taken
        // (They may want a different date — they can check the site)
        const notifActions = waitlist.map(entry =>
          Promise.allSettled([
            sms.sendSMS(entry.phone, `Hi ${entry.name?.split(' ')[0]}, your waitlisted date (${booking.eventDate}) has been booked by someone else. Visit allaroundchitown.com to find another date!`),
          ])
        );
        await Promise.allSettled(notifActions);
        await firebase.markWaitlistNotified(waitlist.map(w => w.id));
      })(),
    ]);

    // Log any failures (don't fail the webhook response)
    actions.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error(`Action ${i} failed:`, result.reason?.message);
      }
    });
  }

  res.json({ received: true });
});

// ╔══════════════════════════════════════════════════════════╗
// ║  CONTACT FORM INQUIRY                                   ║
// ╚══════════════════════════════════════════════════════════╝

app.post('/api/inquiry', async (req, res) => {
  try {
    const { firstName, lastName, email: custEmail, phone,
            eventType, eventDate, packageName, message } = req.body;

    if (!firstName || !custEmail || !eventType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data = {
      name: `${firstName} ${lastName}`,
      email: custEmail, phone, eventType,
      eventDate, package: packageName, message,
    };

    await Promise.allSettled([
      email.sendInquiryNotification(data),
      sms.sendInquiryConfirmation({ phone, name: data.name }),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send inquiry' });
  }
});

// ╔══════════════════════════════════════════════════════════╗
// ║  WAITLIST                                               ║
// ╚══════════════════════════════════════════════════════════╝

app.post('/api/waitlist', async (req, res) => {
  try {
    const { date, name, email: custEmail, phone } = req.body;
    if (!date || !name || !custEmail) {
      return res.status(400).json({ error: 'date, name, and email required' });
    }
    await firebase.addToWaitlist(date, { name, email: custEmail, phone: phone || '' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ╔══════════════════════════════════════════════════════════╗
// ║  ADMIN                                                  ║
// ╚══════════════════════════════════════════════════════════╝

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// GET /api/admin/dashboard
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const [bookings, waitlist] = await Promise.all([
      firebase.getAllBookings(),
      firebase.getAllWaitlist(),
    ]);

    const totalRevenue = bookings.reduce((s, b) => s + (b.depositAmount || 0), 0);
    const confirmed    = bookings.filter(b => b.status === 'confirmed');
    const upcoming     = confirmed.filter(b => b.eventDate >= new Date().toISOString().split('T')[0]);

    res.json({
      stats: {
        totalBookings: confirmed.length,
        upcomingEvents: upcoming.length,
        totalDepositRevenue: totalRevenue,
        waitlistCount: waitlist.filter(w => !w.notified).length,
      },
      bookings,
      waitlist,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/bookings/:id
app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    await firebase.updateBooking(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/waitlist/:id/notify  — manually notify one waitlist entry
app.post('/api/admin/waitlist/:id/notify', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email: custEmail, phone, date } = req.body;
    await Promise.allSettled([
      sms.sendWaitlistNotification({ phone, name, date }),
      email.sendWaitlistEmail({ email: custEmail, name, date }),
    ]);
    await firebase.markWaitlistNotified([id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║  All Around Chi-Town API              ║
  ║  Running on port ${PORT}               ║
  ╚════════════════════════════════════════╝
  `);
});
