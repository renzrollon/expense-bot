import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/reports/build";

const EXAMPLE_WEEK = [
  { categoryId: "groceries", totalCentavos: 320000, count: 8 },
  { categoryId: "dining", totalCentavos: 215000, count: 5 },
  { categoryId: "transport", totalCentavos: 130000, count: 4 },
  { categoryId: "bills", totalCentavos: 110000, count: 3 },
  { categoryId: "other", totalCentavos: 70000, count: 3 },
  { categoryId: "transfer", totalCentavos: 200000, count: 1 },
];

describe("The system SHALL total a period by category", () => {
  it("Happy path — totals, order and shares", () => {
    expect(buildReport(EXAMPLE_WEEK)).toEqual({
      totalCentavos: 845000,
      count: 23,
      lines: [
        { categoryId: "groceries", totalCentavos: 320000, share: 38 },
        { categoryId: "dining", totalCentavos: 215000, share: 25 },
        { categoryId: "transport", totalCentavos: 130000, share: 15 },
        { categoryId: "bills", totalCentavos: 110000, share: 13 },
        { categoryId: "other", totalCentavos: 70000, share: 8 },
      ],
      notCounted: [{ categoryId: "transfer", totalCentavos: 200000 }],
      empty: false,
    });
  });

  it("Edge case — a removed entry counts nowhere", () => {
    const report = buildReport(EXAMPLE_WEEK.filter((row) => row.categoryId !== "other"));
    expect(report.totalCentavos).toBe(775000);
    expect(report.count).toBe(20);
    expect(report.lines.map((line) => line.categoryId)).not.toContain("other");
  });

  it("Edge case — a category that is no longer in the list", () => {
    const report = buildReport([{ categoryId: "snacks", totalCentavos: 50000, count: 1 }]);
    expect(report.totalCentavos).toBe(50000);
    expect(report.count).toBe(1);
    expect(report.lines).toEqual([{ categoryId: "snacks", totalCentavos: 50000, share: 100 }]);
    expect(report.notCounted).toEqual([]);
  });

  it("Edge case — a half is rounded up", () => {
    const report = buildReport([
      { categoryId: "groceries", totalCentavos: 87500, count: 1 },
      { categoryId: "dining", totalCentavos: 12500, count: 1 },
    ]);
    expect(report.lines.map((line) => line.share)).toEqual([88, 13]);
  });

  it("Edge case — no rows is an empty report", () => {
    expect(buildReport([])).toEqual({ totalCentavos: 0, count: 0, lines: [], notCounted: [], empty: true });
  });

  it("Edge case — only a not-counted row is not empty", () => {
    expect(buildReport([{ categoryId: "transfer", totalCentavos: 200000, count: 1 }])).toEqual({
      totalCentavos: 0,
      count: 0,
      lines: [],
      notCounted: [{ categoryId: "transfer", totalCentavos: 200000 }],
      empty: false,
    });
  });
});
