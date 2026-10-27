/**
 * Business day boundaries.
 *
 * Autowra operates in India, so "today", "this week" and "this month" on an earnings
 * dashboard must be IST day boundaries rather than UTC ones - otherwise a job completed at
 * 02:00 IST would fall into the previous day's totals.
 */
export const IST_OFFSET_MINUTES = 330;

const DAY_MS = 86_400_000;

export function istStartOfDay(now: Date = new Date()): Date {
  const shifted = shiftToIst(now);
  return shiftFromIst(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export function istEndOfDay(now: Date = new Date()): Date {
  return new Date(istStartOfDay(now).getTime() + DAY_MS - 1);
}

/** Weeks start on Monday, the Indian business convention. */
export function istStartOfWeek(now: Date = new Date()): Date {
  const shifted = shiftToIst(now);
  const weekday = shifted.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return shiftFromIst(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysSinceMonday),
  );
}

export function istStartOfMonth(now: Date = new Date()): Date {
  const shifted = shiftToIst(now);
  return shiftFromIst(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1));
}

function shiftToIst(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
}

function shiftFromIst(utcMs: number): Date {
  return new Date(utcMs - IST_OFFSET_MINUTES * 60_000);
}
