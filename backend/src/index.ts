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

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? '*' : 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_, res) => res.json({
  status: 'ok', ts: new Date().toISOString(),
  twilio: !!process.env.TWILIO_ACCOUNT_SID,
  claude: !!process.env.CLAUDE_API_KEY,
}));

    const hash = bcrypt.default.hashSync('admin123456', 10);
    await queryRun(
      'INSERT INTO users(id,email,password_hash,role,tenant_id,is_active) VALUES($1,$2,$3,$4,$5,$6)',
      [uuid(), 'admin@bookingai.com', hash, 'super_admin', null, 1]
    );
    res.json({ success: true, message: 'Admin created: admin@bookingai.com / admin123456' });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api', router);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/whatsapp', whatsappRouter);

async function start() {
  await runMigrations();
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
