# BookingAI — Calendar Tool

Local-first booking calendar for barbershops, salons, and clinics.
Designed to migrate to AWS with zero code changes.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Node.js + TypeScript + Express |
| Database | SQLite (local) → RDS PostgreSQL (cloud) |
| Frontend | React + TypeScript + Vite + Tailwind |
| API      | REST, JSON |

## Quick start

```bash
chmod +x start.sh
./start.sh
```

Opens:
- **Frontend** → http://localhost:5173
- **Backend API** → http://localhost:3001/api

## Features

- **Week / Day calendar** — click any slot to create a booking
- **Booking management** — create, view, reschedule, complete, cancel
- **Conflict detection** — blocks double-bookings, suggests next available slots
- **Specialists** — manage team, set working hours per day
- **Services catalog** — name, duration, price, color coding
- **Filter by specialist** — sidebar toggle

## API reference

```
GET    /api/specialists
POST   /api/specialists
PUT    /api/specialists/:id
PUT    /api/specialists/:id/working-hours

GET    /api/services
POST   /api/services
PUT    /api/services/:id
DELETE /api/services/:id

GET    /api/bookings?start=&end=&specialistId=
POST   /api/bookings
PUT    /api/bookings/:id
DELETE /api/bookings/:id          (soft cancel)

GET    /api/availability?specialistId=&date=&durationMins=
GET    /api/availability/suggest?specialistId=&fromDate=&durationMins=
```

## Migrating to AWS

Only two things change when moving to cloud:

1. **Database** — swap `better-sqlite3` for `pg` (postgres) and update `src/db/database.ts`.
   The SQL is ANSI-compatible. Connection string comes from `DATABASE_URL` env var.

2. **Environment** — set these env vars in ECS task definition (already defined in Terraform):
   ```
   DATABASE_URL=postgresql://user:pass@rds-endpoint/bookingai
   PORT=3001
   NODE_ENV=production
   ```

The frontend just needs `VITE_API_URL` pointing to the ALB DNS name.
Everything else — routes, business logic, availability engine — is identical.

## Project structure

```
bookingai/
├── start.sh                        ← run this first
├── backend/
│   ├── src/
│   │   ├── index.ts                ← Express server
│   │   ├── db/
│   │   │   ├── database.ts         ← SQLite setup + migrations
│   │   │   └── seed.ts             ← demo data
│   │   ├── routes/
│   │   │   └── api.ts              ← all REST endpoints
│   │   ├── services/
│   │   │   └── availability.ts     ← slot engine
│   │   └── types/index.ts
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.tsx                 ← shell + routing
    │   ├── components/
    │   │   ├── calendar/CalendarView.tsx
    │   │   ├── bookings/BookingModal.tsx
    │   │   ├── specialists/SpecialistsPage.tsx
    │   │   ├── services/ServicesPage.tsx
    │   │   └── ui/index.tsx
    │   ├── lib/api.ts              ← all fetch calls
    │   └── types/index.ts
    └── package.json
```
