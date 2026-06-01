import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/database.js';
import { whatsappRouter } from './whatsapp/webhook.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { bookingRouter } from './modules/booking/routes.js';
import { artEventRouter } from './modules/art_event/routes.js';
import { artClassRouter } from './modules/art_class/routes.js';
import { restaurantRouter } from './modules/restaurant/routes.js';
import { hotelRouter } from './routes/hotel.js';
import { emailWebhookRouter } from './routes/emailWebhook.js';
import { skedaiRouter } from './skedai/routes.js';
import { startDigestCron } from './reviews/digestCron.js';
import { adminAnalyticsRouter } from './routes/adminAnalytics.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    'https://app.skedai.net',
    'https://www.skedai.net',
    'https://bookingai-one.vercel.app',
    'http://localhost:5173',
  ],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

app.get('/health', (_, res) => res.json({
  status: 'ok', ts: new Date().toISOString(),
  twilio: !!process.env.TWILIO_ACCOUNT_SID,
  claude: !!process.env.CLAUDE_API_KEY,
}));

app.use('/api', bookingRouter);
app.use('/api', artEventRouter);
app.use('/api', artClassRouter);
app.use('/api', restaurantRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/admin/analytics', adminAnalyticsRouter);
app.use('/hotel', hotelRouter);
app.use('/api', skedaiRouter);
app.use('/whatsapp', whatsappRouter);
app.use('/', emailWebhookRouter);

async function start() {
  await runMigrations();
  startDigestCron();
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n🚀 BookingAI backend running at http://localhost:${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api`);
    console.log(`   WhatsApp:  http://localhost:${PORT}/whatsapp/webhook`);
    console.log(`   Auth:      http://localhost:${PORT}/auth/login`);
    console.log(`   Admin:     http://localhost:${PORT}/admin/tenants`);
    console.log(`   Health:    http://localhost:${PORT}/health`);
    console.log(`\n   Twilio: ${!!process.env.TWILIO_ACCOUNT_SID ? '✅' : '❌ missing TWILIO_ACCOUNT_SID'}`);
    console.log(`   Claude: ${!!process.env.CLAUDE_API_KEY ? '✅' : '❌ missing CLAUDE_API_KEY'}\n`);
  });
}

start().catch(err => { console.error(err); process.exit(1); });
