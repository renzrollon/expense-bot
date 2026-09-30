import { describe, expect, it } from "vitest";
import { isRealDate, localDate, nearestDate, shiftDate } from "../../src/parser/dates";

describe("localDate", () => {
  it.each<[string, string, string, string]>([
    ["the start of the day in Manila", "2026-09-29T00:00:00.000Z", "Asia/Manila", "2026-09-29"],
    ["the last moment of the day in Manila", "2026-09-29T15:59:59.999Z", "Asia/Manila", "2026-09-29"],
    ["midnight in Manila", "2026-09-29T16:00:00.000Z", "Asia/Manila", "2026-09-30"],
    ["the new year in Manila", "2026-12-31T16:30:00.000Z", "Asia/Manila", "2027-01-01"],
    ["the previous day in Los Angeles", "2026-09-29T00:00:00.000Z", "America/Los_Angeles", "2026-09-28"],
    ["UTC", "2026-09-29T00:00:00.000Z", "UTC", "2026-09-29"],
  ])("gives %s", (_label, iso, timezone, expected) => {
    expect(localDate(new Date(iso), timezone)).toEqual(expected);
  });

  it.each<[string, Date, string]>([
    ["an invalid Date", new Date(Number.NaN), "Asia/Manila"],
    ["an unknown timezone", new Date("2026-09-29T00:00:00.000Z"), "Mars/Olympus"],
  ])("throws RangeError for %s", (_label, now, timezone) => {
    expect(() => localDate(now, timezone)).toThrow(RangeError);
  });
});

describe("shiftDate", () => {
  it.each<[string, string, number, string]>([
    ["no shift", "2026-09-29", 0, "2026-09-29"],
    ["one day back", "2026-09-29", -1, "2026-09-28"],
    ["across a month boundary", "2026-09-29", -30, "2026-08-30"],
    ["the largest shift", "2026-09-29", -9999, "1999-05-15"],
    ["across a year boundary", "2027-01-01", -1, "2026-12-31"],
    ["into a leap day", "2024-03-01", -1, "2024-02-29"],
    ["into the end of February", "2026-03-01", -1, "2026-02-28"],
  ])("gives %s", (_label, date, days, expected) => {
    expect(shiftDate(date, days)).toEqual(expected);
  });
});

describe("isRealDate", () => {
  it.each<[string, number, number, number, boolean]>([
    ["a leap day in a leap year", 2024, 2, 29, true],
    ["a leap day in another year", 2026, 2, 29, false],
    ["the 31st of a short month", 2026, 9, 31, false],
    ["month 13", 2026, 13, 1, false],
    ["month 0", 2026, 0, 1, false],
    ["day 0", 2026, 1, 0, false],
    ["a year below 100", 50, 1, 1, true],
  ])("decides %s", (_label, year, month, day, expected) => {
    expect(isRealDate(year, month, day)).toEqual(expected);
  });
});

describe("nearestDate", () => {
  it.each<[string, number, number, string, string | null]>([
    ["a date two days back", 9, 27, "2026-09-29", "2026-09-27"],
    ["today", 9, 29, "2026-09-29", "2026-09-29"],
    ["the start of this year", 1, 1, "2026-09-29", "2026-01-01"],
    ["a future date 16 days ahead", 10, 15, "2026-09-29", "2026-10-15"],
    ["a future date 92 days ahead", 12, 30, "2026-09-29", "2026-12-30"],
    ["a date in the previous year", 12, 30, "2027-01-02", "2026-12-30"],
    ["a tie, which goes to the earlier date", 12, 31, "2028-07-01", "2027-12-31"],
    ["a leap day in the previous year", 2, 29, "2025-03-05", "2024-02-29"],
    ["a leap day this year", 2, 29, "2024-03-01", "2024-02-29"],
    ["a leap day in neither year", 2, 29, "2026-09-29", null],
    ["a day that no year has", 9, 31, "2026-09-29", null],
  ])("finds %s", (_label, month, day, today, expected) => {
    expect(nearestDate(month, day, today)).toEqual(expected);
  });
});
