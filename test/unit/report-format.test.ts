import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/reports/build";
import { formatReport } from "../../src/reports/format";

describe("The system SHALL write a report as plain text", () => {
  it("Happy path — a full report", () => {
    const report = buildReport([
      { categoryId: "groceries", totalCentavos: 320000, count: 8 },
      { categoryId: "dining", totalCentavos: 215000, count: 5 },
      { categoryId: "transport", totalCentavos: 130000, count: 4 },
      { categoryId: "bills", totalCentavos: 110000, count: 3 },
      { categoryId: "other", totalCentavos: 70000, count: 3 },
      { categoryId: "transfer", totalCentavos: 200000, count: 1 },
    ]);
    expect(formatReport("This week · Sep 28 to Sep 29", report)).toBe(
      [
        "📊 This week · Sep 28 to Sep 29",
        "₱8,450 · 23 entries",
        "",
        "🛒 Groceries · ₱3,200 · 38%",
        "🍽 Dining · ₱2,150 · 25%",
        "🚗 Transport · ₱1,300 · 15%",
        "💡 Bills · ₱1,100 · 13%",
        "❓ Other · ₱700 · 8%",
        "",
        "Not counted: 🔁 Transfers ₱2,000",
      ].join("\n"),
    );
  });

  it("Failure — the period has no entries", () => {
    expect(formatReport("Today · Sep 29", buildReport([]))).toBe("📊 Today · Sep 29 · no entries");
  });

  it("Edge case — only entries that are not counted", () => {
    const report = buildReport([{ categoryId: "transfer", totalCentavos: 200000, count: 1 }]);
    expect(formatReport("Today · Sep 29", report)).toBe(
      ["📊 Today · Sep 29", "₱0 · 0 entries", "", "Not counted: 🔁 Transfers ₱2,000"].join("\n"),
    );
  });

  it("Edge case — one entry, with centavos", () => {
    const report = buildReport([{ categoryId: "groceries", totalCentavos: 150050, count: 1 }]);
    expect(formatReport("Today · Sep 29", report)).toBe(
      ["📊 Today · Sep 29", "₱1,500.50 · 1 entry", "", "🛒 Groceries · ₱1,500.50 · 100%"].join("\n"),
    );
  });

  it("Edge case — a very small share and an unknown category", () => {
    const report = buildReport([
      { categoryId: "groceries", totalCentavos: 844000, count: 5 },
      { categoryId: "snacks", totalCentavos: 1000, count: 1 },
    ]);
    expect(formatReport("Today · Sep 29", report)).toBe(
      ["📊 Today · Sep 29", "₱8,450 · 6 entries", "", "🛒 Groceries · ₱8,440 · 100%", "snacks · ₱10 · <1%"].join("\n"),
    );
  });

  it("Edge case — several not-counted categories share one line", () => {
    const report = buildReport([{ categoryId: "transfer", totalCentavos: 200000, count: 1 }]);
    report.notCounted.push({ categoryId: "old", totalCentavos: 5000 });
    expect(formatReport("T", report)).toContain("Not counted: 🔁 Transfers ₱2,000, old ₱50");
  });
});
