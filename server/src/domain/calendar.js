import { z } from 'zod';

export const calendarDateSchema = z.iso.date().refine(
  (date) => !date.startsWith('0000-'),
  'Use a calendar year from 0001 to 9999.',
);

// Input is an already validated date-only string. UTC here keeps arithmetic
// independent of the process time zone. The input represents an IST business date.
export function addCalendarDays(date, days) {
  const cursor = new Date(date + 'T00:00:00.000Z');
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().split('T')[0];
}
