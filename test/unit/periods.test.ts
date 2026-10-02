import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  monthStart,
  monthTitle,
  previousMonth,
  rangeLabel,
  shortDate,
  weekStart,
} from "../../src/reports/periods";
import type { Period } from "../../src/ledger/types";

describe("weekStart", () => {
  it.each<[string, string, string]>([
    ["a Monday is its own week start", "2026-09-28", "2026-09-28"],
    ["a Sunday belongs to the week that began six days before", "2026-10-04", "2026-09-28"],
    ["a mid-week date (Wednesday)", "2026-09-30", "2026-09-28"],
    ["a week that crosses a month end", "2026-10-01", "2026-09-28"],
    ["a week that crosses a year end", "2027-01-02", "2026-12-28"],
  ])("%s", (_label, date, expected) => {
    expect(weekStart(date)).toBe(expected);
  });
});

describe("monthStart", () => {
  it.each<[string, string, string]>([
    ["a mid-month date", "2026-09-29", "2026-09-01"],
    ["the 1st is its own month start", "2026-10-01", "2026-10-01"],
    ["the last day of a year", "2026-12-31", "2026-12-01"],
  ])("%s", (_label, date, expected) => {
    expect(monthStart(date)).toBe(expected);
  });
});

describe("previousMonth", () => {
  it.each<[string, string, Period]>([
    ["the 1st of October gives September", "2026-10-01", { from: "2026-09-01", to: "2026-09-30" }],
    ["a date in January gives December of the year before", "2027-01-15", { from: "2026-12-01", to: "2026-12-31" }],
    ["a date in March 2027 gives February of a common year", "2027-03-01", { from: "2027-02-01", to: "2027-02-28" }],
    ["a date in March 2028 gives February of a leap year", "2028-03-31", { from: "2028-02-01", to: "2028-02-29" }],
  ])("%s", (_label, date, expected) => {
    expect(previousMonth(date)).toEqual(expected);
  });
});

describe("daysInMonth", () => {
  it.each<[string, string, number]>([
    ["February 2027", "2027-02-10", 28],
    ["February in the leap year 2028", "2028-02-10", 29],
    ["September", "2026-09-01", 30],
    ["December", "2026-12-31", 31],
  ])("%s", (_label, date, expected) => {
    expect(daysInMonth(date)).toBe(expected);
  });
});

describe("shortDate", () => {
  it.each<[string, string]>([
    ["2026-09-28", "Sep 28"],
    ["2026-10-01", "Oct 1"],
    ["2027-01-02", "Jan 2"],
  ])("%s is %s", (date, expected) => {
    expect(shortDate(date)).toBe(expected);
  });
});

describe("rangeLabel", () => {
  it.each<[string, Period, string]>([
    ["a range of one date", { from: "2026-09-29", to: "2026-09-29" }, "Sep 29"],
    ["a range in one month", { from: "2026-09-28", to: "2026-09-29" }, "Sep 28 to Sep 29"],
    ["a week that crosses a month end", { from: "2026-09-28", to: "2026-10-04" }, "Sep 28 to Oct 4"],
    ["a week that crosses a year end", { from: "2026-12-28", to: "2027-01-03" }, "Dec 28 to Jan 3"],
  ])("%s", (_label, period, expected) => {
    expect(rangeLabel(period)).toBe(expected);
  });
});

describe("monthTitle", () => {
  it.each<[string, string]>([
    ["2026-12-01", "December 2026"],
    ["2026-09-01", "September 2026"],
    ["2028-02-29", "February 2028"],
  ])("%s is %s", (date, expected) => {
    expect(monthTitle(date)).toBe(expected);
  });
});
