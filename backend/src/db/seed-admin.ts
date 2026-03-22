import { runMigrations, prepare } from './database.js';
import bcrypt from 'bcryptjs';

async function seedAdmin() {
  await runMigrations();

  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@bookingai.com';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

  // Check if admin already exists
  const existing = prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL) as any;

  if (existing) {
    console.log(`ℹ️  Admin already exists: ${ADMIN_EMAIL}`);
    return;
  }

  const id   = crypto.randomUUID();
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

  prepare(`
    INSERT INTO users(id, email, password_hash, role, tenant_id, is_active)
    VALUES (?, ?, ?, 'super_admin', NULL, 1)
  `).run(id, ADMIN_EMAIL, hash);

  console.log(`\n✅ Super admin created`);
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`\n   ⚠️  Change this password after first login!\n`);

  // Also create a shop_owner account for the demo tenant
  const demoEmail    = 'demo@bookingai.com';
  const demoPassword = 'demo123456';
  const demoExists   = prepare('SELECT id FROM users WHERE email = ?').get(demoEmail) as any;

  if (!demoExists) {
    const demoId   = crypto.randomUUID();
    const demoHash = bcrypt.hashSync(demoPassword, 10);
    prepare(`
      INSERT INTO users(id, email, password_hash, role, tenant_id, is_active)
      VALUES (?, ?, ?, 'shop_owner', 'tenant-demo-001', 1)
    `).run(demoId, demoEmail, demoHash);

    console.log(`✅ Demo shop owner created`);
    console.log(`   Email:    ${demoEmail}`);
    console.log(`   Password: ${demoPassword}`);
    console.log(`   Tenant:   tenant-demo-001 (Gentian's Barbershop)\n`);
  }
}

seedAdmin().catch(err => { console.error(err); process.exit(1); });
