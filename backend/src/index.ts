import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runMigrations, backfillEmailBodies } from './db/database.js';
import { whatsappRouter } from './whatsapp/webhook.js';
import metaRouter from './whatsapp/metaWebhook.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { bookingRouter } from './modules/booking/routes.js';
import { artEventRouter } from './modules/art_event/routes.js';
import { artClassRouter } from './modules/art_class/routes.js';
import { restaurantRouter } from './modules/restaurant/routes.js';
import { happyRestaurantRouter } from './modules/happyRestaurant/routes.js';
import { hotelRouter } from './routes/hotel.js';
import { hotelMenusRouter } from './routes/hotelMenus.js';
import { shopRouter } from './routes/shop.js';
import { emailWebhookRouter } from './routes/emailWebhook.js';
import { skedaiRouter } from './skedai/routes.js';
import { startDigestCron } from './reviews/digestCron.js';
import { startShopCron } from './shop/cron.js';
import { emailAccountsRouter } from './routes/emailAccounts.js';
import { startEmailWorker } from './channels/email/worker.js';
import { adminAnalyticsRouter } from './routes/adminAnalytics.js';
import { alertError, cleanupCooldowns } from './utils/errorMonitor.js';
import instagramRouter from './routes/instagramWebhook.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// 1. Helmet — security headers (before everything)
app.use(helmet({ contentSecurityPolicy: false }));

// 2. CORS — before rate limiting so OPTIONS preflight works
app.use(cors({
  origin: [
    'https://app.skedai.net',
    'https://www.skedai.net',
    'https://bookingai-one.vercel.app',
    'http://localhost:5173',
  ],
  credentials: true,
}));

// 3. Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 4. Rate limiters
// Auth: 5 failed attempts per hour per IP (brute-force protection)
const authLimiter = rateLimit({
  windowMs:               60 * 60 * 1000,
  max:                    5,
  skipSuccessfulRequests: true,
  standardHeaders:        true,
  legacyHeaders:          false,
  message:                { error: 'Too many login attempts. Try again in 1 hour.' },
});
app.use('/auth/', authLimiter);
app.use('/api/auth/', authLimiter);
app.use('/restaurant/auth/', authLimiter); // happy_ POS PIN login — short PINs need brute-force protection too

// Public QR ordering: 300 per 15 min per IP
// (50 guests sharing one WiFi router × ~4 requests each = ~200; 300 gives headroom)
const publicShopLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again shortly.' },
  skip:            (_req, _res) => _req.method === 'OPTIONS',
});
app.use('/shop/public/', publicShopLimiter);

// General API (dashboard routes): 200 per 15 min per IP
// (8-second polling = ~112 requests per 15 min; 200 gives comfortable headroom)
const generalApiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again shortly.' },
  skip:            (_req, _res) => _req.method === 'OPTIONS',
});
app.use('/shop/', generalApiLimiter);
app.use('/hotel/', generalApiLimiter);
app.use('/restaurant/', generalApiLimiter);
app.use('/admin/', generalApiLimiter);
app.use('/api/', generalApiLimiter);
// NOTE: /whatsapp/ and /meta/ routes are intentionally NOT rate limited —
// Meta/Twilio send bursts that could trip a limiter; they use signature validation.

app.get('/health', (_, res) => res.json({
  status: 'ok', ts: new Date().toISOString(),
  twilio: !!process.env.TWILIO_ACCOUNT_SID,
  claude: !!process.env.CLAUDE_API_KEY,
  r2: !!process.env.R2_BUCKET_NAME,
}));

app.use('/api', bookingRouter);
app.use('/api', artEventRouter);
app.use('/api', artClassRouter);
app.use('/api', restaurantRouter);
app.use(happyRestaurantRouter); // sub-routes already carry the '/restaurant/...' prefix themselves
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/admin/analytics', adminAnalyticsRouter);
app.use('/hotel', hotelRouter);
app.use('/hotel', hotelMenusRouter);
app.use('/hotel/email', emailAccountsRouter);
app.use('/shop', shopRouter);
app.use('/api', skedaiRouter);
app.use('/whatsapp', whatsappRouter);
app.use('/', metaRouter);
app.use('/', instagramRouter);
app.use('/', emailWebhookRouter);

app.get('/test-alert', (_req, res) => {
  alertError(new Error('Test alert from /test-alert endpoint'), 'test');
  res.json({ ok: true, message: 'Alert triggered (check email in ~5s)' });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  alertError(err, 'expressGlobalError');
  res.status(500).json({ error: 'Internal server error' });
});

process.on('unhandledRejection', (reason) => {
  alertError(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
});

process.on('uncaughtException', (err) => {
  alertError(err, 'uncaughtException');
});

setInterval(cleanupCooldowns, 3_600_000);

async function start() {
  await runMigrations();
  backfillEmailBodies().catch((e: any) => console.error('[Email] backfill error:', e.message));
  startDigestCron();
  startShopCron();
  startEmailWorker();
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n🚀 BookingAI backend running at http://localhost:${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api`);
    console.log(`   WhatsApp:  http://localhost:${PORT}/whatsapp/webhook`);
    console.log(`   Auth:      http://localhost:${PORT}/auth/login`);
    console.log(`   Admin:     http://localhost:${PORT}/admin/tenants`);
    console.log(`   Health:    http://localhost:${PORT}/health`);
    console.log(`\n   Twilio: ${!!process.env.TWILIO_ACCOUNT_SID ? '✅' : '❌ missing TWILIO_ACCOUNT_SID'}`);
    console.log(`   Claude: ${!!process.env.CLAUDE_API_KEY ? '✅' : '❌ missing CLAUDE_API_KEY'}`);
    const r2Ok = !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_ENDPOINT && process.env.R2_BUCKET_NAME && process.env.R2_PUBLIC_URL);
    console.log(`   R2:     ${r2Ok ? '✅' : '❌ missing R2_* env vars — file uploads will fail'}`);
    console.log(`   Alerts: ${process.env.RESEND_API_KEY ? '✅ → Merjemajkejdi@gmail.com' : '❌ missing RESEND_API_KEY'}\n`);
  });
}

start().catch(err => { console.error(err); process.exit(1); });
