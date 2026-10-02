import type { Period } from "../ledger/types";
import { shiftDate } from "../parser/dates";

/**
 * Week and month bounds and their labels, over local dates written `YYYY-MM-DD`
 * (design Decisions 11, 13 and 16). Pure: callers pass the date that is "today"
 * (`localDate`) or a job's `scheduledDate`, never a `Date`.
 */

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function split(date: string): [number, number, number] {
  return date.split("-").map(Number) as [number, number, number];
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The Monday of the Monday-to-Sunday week that holds `date`. */
export function weekStart(date: string): string {
  const [year, month, day] = split(date);
  // getUTCDay: 0 for Sunday; days since Monday is (weekday + 6) % 7.
  const sinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return shiftDate(date, -sinceMonday);
}

/** The first day of the month that holds `date`. */
export function monthStart(date: string): string {
  const [year, month] = split(date);
  return format(year, month, 1);
}

/** The number of days in the month that holds `date`. */
export function daysInMonth(date: string): number {
  const [year, month] = split(date);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The whole calendar month before the month that holds `date`. */
export function previousMonth(date: string): Period {
  const last = shiftDate(monthStart(date), -1);
  return { from: monthStart(last), to: last };
}

/** A date as the short English month and the day, such as `Sep 28`. */
export function shortDate(date: string): string {
  const [, month, day] = split(date);
  return `${SHORT_MONTHS[month - 1]} ${day}`;
}

/** `<first date> to <last date>`, or the one date when both are the same. */
export function rangeLabel(period: Period): string {
  if (period.from === period.to) return shortDate(period.from);
  return `${shortDate(period.from)} to ${shortDate(period.to)}`;
}

/** The month that holds `date` as `<month name> <year>`, such as `December 2026`. */
export function monthTitle(date: string): string {
  const [year, month] = split(date);
  return `${LONG_MONTHS[month - 1]} ${year}`;
}
