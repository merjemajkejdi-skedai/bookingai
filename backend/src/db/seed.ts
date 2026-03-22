import { prepare, exec, runMigrations } from './database.js';
import { v4 as uuid } from 'uuid';
import { addDays, setHours, setMinutes, format, startOfWeek } from 'date-fns';

async function main() {
  await runMigrations();

  exec(`DELETE FROM bookings`);
  exec(`DELETE FROM working_hours`);
  exec(`DELETE FROM services`);
  exec(`DELETE FROM specialists`);
  exec(`DELETE FROM tenants`);

  const tenantId = 'tenant-demo-001';
  prepare(`INSERT INTO tenants(id,name,type,timezone) VALUES (?,?,?,?)`)
    .run(tenantId, "Gentian's Barbershop", 'barbershop', 'Europe/Tirane');

  const specialists = [
    { id: 'spec-001', name: 'Gentian Hoxha', role: 'Senior Barber', color: '#6366f1' },
    { id: 'spec-002', name: 'Arben Koci',    role: 'Barber',        color: '#f59e0b' },
    { id: 'spec-003', name: 'Blerim Shehu',  role: 'Junior Barber', color: '#10b981' },
  ];

  for (const s of specialists) {
    prepare(`INSERT INTO specialists(id,tenant_id,name,role,color,is_active) VALUES (?,?,?,?,?,1)`)
      .run(s.id, tenantId, s.name, s.role, s.color);
    for (let day = 0; day <= 6; day++) {
      prepare(`INSERT INTO working_hours(id,specialist_id,day_of_week,start_time,end_time,is_working) VALUES (?,?,?,?,?,?)`)
        .run(uuid(), s.id, day, '09:00', '19:00', day === 0 ? 0 : 1);
    }
  }

  const services = [
    { id: 'svc-001', name: 'Haircut',         duration: 30, price: 1200, color: '#6366f1' },
    { id: 'svc-002', name: 'Haircut + Beard', duration: 45, price: 1800, color: '#8b5cf6' },
    { id: 'svc-003', name: 'Beard Trim',      duration: 20, price: 800,  color: '#f59e0b' },
    { id: 'svc-004', name: 'Hot Towel Shave', duration: 40, price: 1500, color: '#ef4444' },
    { id: 'svc-005', name: 'Kids Haircut',    duration: 25, price: 800,  color: '#10b981' },
    { id: 'svc-006', name: 'Hair Color',      duration: 90, price: 3500, color: '#ec4899' },
  ];

  for (const s of services) {
    prepare(`INSERT INTO services(id,tenant_id,name,duration_mins,price,color,is_active) VALUES (?,?,?,?,?,?,1)`)
      .run(s.id, tenantId, s.name, s.duration, s.price, s.color);
  }

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const templates = [
    { day:0, hour:9,  min:0,  spec:'spec-001', svc:'svc-001', customer:'Altin Duka',   phone:'+355691234567' },
    { day:0, hour:10, min:0,  spec:'spec-001', svc:'svc-002', customer:'Endri Leka',   phone:'+355692345678' },
    { day:0, hour:9,  min:30, spec:'spec-002', svc:'svc-003', customer:'Fatos Marku',  phone:'+355693456789' },
    { day:0, hour:11, min:0,  spec:'spec-002', svc:'svc-001', customer:'Gezim Haxhiu', phone:'+355694567890' },
    { day:1, hour:9,  min:0,  spec:'spec-001', svc:'svc-004', customer:'Ilir Prifti',  phone:'+355695678901' },
    { day:1, hour:10, min:30, spec:'spec-001', svc:'svc-001', customer:'Kujtim Basha', phone:'+355696789012' },
    { day:1, hour:9,  min:0,  spec:'spec-002', svc:'svc-002', customer:'Luan Gashi',   phone:'+355697890123' },
    { day:1, hour:11, min:0,  spec:'spec-003', svc:'svc-005', customer:'Mirela Domi',  phone:'+355698901234' },
    { day:2, hour:9,  min:0,  spec:'spec-001', svc:'svc-001', customer:'Niko Veli',    phone:'+355699012345' },
    { day:2, hour:14, min:0,  spec:'spec-002', svc:'svc-006', customer:'Ornela Cela',  phone:'+355691123456' },
    { day:2, hour:10, min:0,  spec:'spec-003', svc:'svc-001', customer:'Petrit Shala', phone:'+355691234560' },
    { day:3, hour:9,  min:0,  spec:'spec-001', svc:'svc-002', customer:'Qemal Zogu',   phone:'+355692234561' },
    { day:3, hour:11, min:0,  spec:'spec-002', svc:'svc-003', customer:'Rexhep Hoti',  phone:'+355693234562' },
    { day:4, hour:10, min:0,  spec:'spec-001', svc:'svc-001', customer:'Sokol Rama',   phone:'+355694234563' },
    { day:4, hour:14, min:0,  spec:'spec-003', svc:'svc-004', customer:'Taulant Kuka', phone:'+355695234564' },
  ];

  const ins = prepare(`INSERT INTO bookings(id,tenant_id,specialist_id,service_id,customer_name,customer_phone,starts_at,ends_at,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const t of templates) {
    const svc = services.find(s => s.id === t.svc)!;
    const date = addDays(weekStart, t.day);
    const start = setMinutes(setHours(date, t.hour), t.min);
    const end = new Date(start.getTime() + svc.duration * 60 * 1000);
    ins.run(uuid(), tenantId, t.spec, t.svc, t.customer, t.phone,
      format(start, "yyyy-MM-dd'T'HH:mm:ss"),
      format(end,   "yyyy-MM-dd'T'HH:mm:ss"),
      'confirmed', '');
  }

  console.log(`✅ Seed complete — ${templates.length} bookings created`);
  console.log(`   Specialists: ${specialists.length}, Services: ${services.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
