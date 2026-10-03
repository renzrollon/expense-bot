const MS_PER_DAY = 86_400_000;

/**
 * Today in the timezone, as `YYYY-MM-DD` (design Decision 7). Throws `RangeError`
 * for a timezone the runtime does not know and for an invalid `Date`.
 */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return format(part("year"), part("month"), part("day"));
}

/** The date that many days later, or earlier when `days` is negative. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = split(date);
  return read(utc(year, month, day + days));
}

/** Whether the year, month and day exist in the Gregorian calendar (D36). */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  return read(utc(year, month, day)) === format(year, month, day);
}

/** The date with this year, month and day, or null when it is not a real date. */
export function exactDate(year: number, month: number, day: number): string | null {
  return isRealDate(year, month, day) ? format(year, month, day) : null;
}

/**
 * The nearest real date with this month and day, in the year of `today` or the year
 * before (D18). A tie goes to the earlier date. It may be in the future.
 */
export function nearestDate(month: number, day: number, today: string): string | null {
  const [year] = split(today);
  const todayTime = utc(...split(today)).getTime();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidateYear of [year - 1, year]) {
    if (!isRealDate(candidateYear, month, day)) continue;
    const distance = Math.abs(utc(candidateYear, month, day).getTime() - todayTime) / MS_PER_DAY;
    if (distance < bestDistance) {
      best = format(candidateYear, month, day);
      bestDistance = distance;
    }
  }
  return best;
}

/** UTC midnight of the date. `setUTCFullYear` keeps the years 0 to 99 as they are. */
function utc(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function read(date: Date): string {
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function split(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return [year, month, day];
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
