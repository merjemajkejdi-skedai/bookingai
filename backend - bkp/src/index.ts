import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/database.js';
import { router } from './routes/api.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.use('/api', router);

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`\n🚀 BookingAI backend running at http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  });
}

start().catch(err => { console.error(err); process.exit(1); });
