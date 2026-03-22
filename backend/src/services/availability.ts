import { prepare } from '../db/database.js';
import { addMinutes, format, parseISO, isWithinInterval, startOfDay, endOfDay, getDay } from 'date-fns';

interface BookedSlot {
  startsAt: Date;
  endsAt: Date;
}

interface SlotResult {
  startsAt: string;
  endsAt: string;
  available: boolean;
}

/**
 * Returns all time slots for a specialist on a given date.
 * Slots are generated from working hours, then marked unavailable
 * if overlapping with an existing confirmed booking.
 */
export function getAvailableSlots(
  specialistId: string,
  date: string,        // "YYYY-MM-DD"
  durationMins: number
): SlotResult[] {
  const wh = prepare(`
    SELECT start_time, end_time, is_working
    FROM working_hours
    WHERE specialist_id = ? AND day_of_week = ?
  `).get(specialistId, dayOfWeek) as { start_time: string; end_time: string; is_working: number } | undefined;

  if (!wh || !wh.is_working) return [];

  const dayOfWeek = getDay(parseISO(date));

  const existing = prepare(`
    SELECT starts_at, ends_at FROM bookings
    WHERE specialist_id = ?
      AND status NOT IN ('cancelled')
      AND starts_at LIKE ?
  `).all(specialistId, `${date}%`) as { starts_at: string; ends_at: string }[];

  const bookedSlots: BookedSlot[] = existing.map(b => ({
    startsAt: parseISO(b.starts_at),
    endsAt:   parseISO(b.ends_at),
  }));

  // 3. Generate all possible slots from working hours
  const [startH, startM] = wh.start_time.split(':').map(Number);
  const [endH, endM]     = wh.end_time.split(':').map(Number);
  const baseDate = parseISO(date);
  const dayStart = new Date(baseDate.setHours(startH, startM, 0, 0));
  const dayEnd   = new Date(new Date(parseISO(date)).setHours(endH, endM, 0, 0));

  const slots: SlotResult[] = [];
  let cursor = dayStart;

  while (addMinutes(cursor, durationMins) <= dayEnd) {
    const slotEnd = addMinutes(cursor, durationMins);

    // Check overlap with any existing booking
    const hasOverlap = bookedSlots.some(b =>
      cursor < b.endsAt && slotEnd > b.startsAt
    );

    slots.push({
      startsAt:  format(cursor,  "yyyy-MM-dd'T'HH:mm:ss"),
      endsAt:    format(slotEnd, "yyyy-MM-dd'T'HH:mm:ss"),
      available: !hasOverlap,
    });

    cursor = addMinutes(cursor, 15); // 15-min slot grid
  }

  return slots;
}

/**
 * Find the next N available slots for a specialist+service,
 * looking up to maxDaysAhead days forward.
 * Used by the AI agent when the requested slot is unavailable.
 */
export function suggestNextSlots(
  specialistId: string,
  fromDate: string,
  durationMins: number,
  count: number = 3,
  maxDaysAhead: number = 7
): SlotResult[] {
  const suggestions: SlotResult[] = [];

  for (let d = 0; d < maxDaysAhead && suggestions.length < count; d++) {
    const date = format(addMinutes(parseISO(fromDate), d * 24 * 60), 'yyyy-MM-dd');
    const slots = getAvailableSlots(specialistId, date, durationMins);
    const available = slots.filter(s => s.available);
    suggestions.push(...available.slice(0, count - suggestions.length));
  }

  return suggestions;
}

/**
 * Check if a specific slot is available (used before creating a booking).
 */
export function isSlotAvailable(
  specialistId: string,
  startsAt: string,
  durationMins: number
): boolean {
  const date = startsAt.slice(0, 10);
  const slots = getAvailableSlots(specialistId, date, durationMins);
  return slots.some(s => s.startsAt === startsAt && s.available);
}
