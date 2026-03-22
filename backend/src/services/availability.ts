import { isPg, prepare, query, queryOne } from '../db/database.js';
import { addMinutes, format, parseISO, getDay } from 'date-fns';

interface BookedSlot { startsAt: Date; endsAt: Date; }
export interface SlotResult { startsAt: string; endsAt: string; available: boolean; }

async function getWorkingHours(specialistId: string, dayOfWeek: number) {
  const sql = 'SELECT start_time, end_time, is_working FROM working_hours WHERE specialist_id=? AND day_of_week=?';
  return isPg
    ? queryOne(sql, [specialistId, dayOfWeek])
    : prepare(sql).get(specialistId, dayOfWeek);
}

async function getExistingBookings(specialistId: string, date: string) {
  const sql = "SELECT starts_at, ends_at FROM bookings WHERE specialist_id=? AND status NOT IN ('cancelled') AND starts_at LIKE ?";
  return isPg
    ? query(sql, [specialistId, `${date}%`])
    : prepare(sql).all(specialistId, `${date}%`);
}

export async function getAvailableSlots(
  specialistId: string, date: string, durationMins: number
): Promise<SlotResult[]> {
  const dayOfWeek = getDay(parseISO(date));
  const wh = await getWorkingHours(specialistId, dayOfWeek) as any;
  if (!wh || !wh.is_working) return [];

  const existing = await getExistingBookings(specialistId, date) as any[];
  const bookedSlots: BookedSlot[] = existing.map(b => ({
    startsAt: parseISO(b.starts_at), endsAt: parseISO(b.ends_at),
  }));

  const [startH, startM] = wh.start_time.split(':').map(Number);
  const [endH, endM]     = wh.end_time.split(':').map(Number);
  const dayStart = new Date(parseISO(date).setHours(startH, startM, 0, 0));
  const dayEnd   = new Date(parseISO(date).setHours(endH, endM, 0, 0));

  const slots: SlotResult[] = [];
  let cursor = dayStart;

  while (addMinutes(cursor, durationMins) <= dayEnd) {
    const slotEnd = addMinutes(cursor, durationMins);
    const hasOverlap = bookedSlots.some(b => cursor < b.endsAt && slotEnd > b.startsAt);
    slots.push({
      startsAt:  format(cursor,  "yyyy-MM-dd'T'HH:mm:ss"),
      endsAt:    format(slotEnd, "yyyy-MM-dd'T'HH:mm:ss"),
      available: !hasOverlap,
    });
    cursor = addMinutes(cursor, 15);
  }
  return slots;
}

export async function suggestNextSlots(
  specialistId: string, fromDate: string, durationMins: number,
  count = 3, maxDaysAhead = 7
): Promise<SlotResult[]> {
  const suggestions: SlotResult[] = [];
  for (let d = 0; d < maxDaysAhead && suggestions.length < count; d++) {
    const date = format(addMinutes(parseISO(fromDate), d * 24 * 60), 'yyyy-MM-dd');
    const slots = await getAvailableSlots(specialistId, date, durationMins);
    suggestions.push(...slots.filter(s => s.available).slice(0, count - suggestions.length));
  }
  return suggestions;
}

export async function isSlotAvailable(
  specialistId: string, startsAt: string, durationMins: number
): Promise<boolean> {
  const date = startsAt.slice(0, 10);
  const slots = await getAvailableSlots(specialistId, date, durationMins);
  return slots.some(s => s.startsAt === startsAt && s.available);
}
