import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/database.js';
import { router } from './routes/api.js';
import { whatsappRouter } from './whatsapp/webhook.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_, res) => res.json({
  status: 'ok', ts: new Date().toISOString(),
  twilio: !!process.env.TWILIO_ACCOUNT_SID,
  claude: !!process.env.CLAUDE_API_KEY,
}));

app.use('/api', router);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/whatsapp', whatsappRouter);

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
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
