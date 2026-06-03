import { isPg, prepare, query, queryOne } from '../db/database.js';

async function dbGet(sql: string, ...p: unknown[]) {
  return isPg ? queryOne(sql, p) : prepare(sql).get(...p);
}
async function dbAll(sql: string, ...p: unknown[]) {
  return isPg ? query(sql, p) : prepare(sql).all(...p);
}

function formatEta(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return '1 hour';
  return `${Math.round((minutes / 60) * 10) / 10} hours`;
}

export interface ScheduleWindow {
  is_after_hours: false;
  response_time_minutes: number;
  eta_display: string;
}

export interface AfterHours {
  is_after_hours: true;
  after_hours_message: string;
  next_window_start: string; // e.g. "08:00"
}

export type ScheduleResult = ScheduleWindow | AfterHours;

/**
 * Returns the active schedule window for a department at the current moment,
 * or an AfterHours result if no window covers now.
 * Returns null only if the department row cannot be found.
 */
export async function getDepartmentSchedule(
  departmentId: string,
  timezone: string = 'Europe/Tirane',
): Promise<ScheduleResult | null> {
  const dept = await dbGet(
    'SELECT scheduling_enabled, response_time_minutes, after_hours_message FROM hotel_departments WHERE id = ?',
    departmentId,
  ) as any;

  if (!dept) return null;

  // Scheduling disabled — use the flat response_time_minutes
  if (!dept.scheduling_enabled) {
    const mins = Number(dept.response_time_minutes) || 30;
    return { is_after_hours: false, response_time_minutes: mins, eta_display: formatEta(mins) };
  }

  // Determine current time in the hotel's timezone
  const now = new Date();
  const hotelTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentMinutes = hotelTime.getHours() * 60 + hotelTime.getMinutes();

  const dayOfWeek = hotelTime.getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dayType   = isWeekend ? 'weekend' : 'weekday';

  const schedules = await dbAll(
    `SELECT * FROM hotel_department_schedules
     WHERE department_id = ? AND (day_type = ? OR day_type = 'both')
     ORDER BY display_order ASC, start_time ASC`,
    departmentId, dayType,
  ) as any[];

  // No windows configured — fall back to flat response time
  if (!schedules.length) {
    const mins = Number(dept.response_time_minutes) || 30;
    return { is_after_hours: false, response_time_minutes: mins, eta_display: formatEta(mins) };
  }

  for (const sched of schedules) {
    const [startH, startM] = String(sched.start_time).split(':').map(Number);
    const [endH,   endM]   = String(sched.end_time).split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins   = endH   * 60 + endM;

    // Handle overnight windows (e.g. 22:00–08:00)
    const inWindow = startMins <= endMins
      ? currentMinutes >= startMins && currentMinutes < endMins   // normal
      : currentMinutes >= startMins || currentMinutes < endMins;  // overnight

    if (inWindow) {
      const mins = Number(sched.response_time_minutes);
      return { is_after_hours: false, response_time_minutes: mins, eta_display: formatEta(mins) };
    }
  }

  // Current time is outside all windows — find the next window start
  const allStarts = schedules
    .map((s: any) => String(s.start_time).slice(0, 5))
    .sort();

  let nextStart = allStarts[0] || '08:00';
  for (const start of allStarts) {
    const [h, m] = start.split(':').map(Number);
    if (h * 60 + m > currentMinutes) { nextStart = start; break; }
  }

  const defaultMsg = 'Your request has been logged and will be attended to first thing in the morning. For urgent matters please call reception.';

  return {
    is_after_hours:      true,
    after_hours_message: dept.after_hours_message || defaultMsg,
    next_window_start:   nextStart,
  };
}
