import { describe, expect, it } from "vitest";
import { monthlyRecapText, weeklyDigestText } from "../../src/digests/format";
import type { CategoryTotal, Entry } from "../../src/ledger";
import { buildReport } from "../../src/reports/build";

const WEEK = { from: "2026-09-28", to: "2026-10-04" };
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

function total(categoryId: string, pesos: number, count = 1): CategoryTotal {
  return { categoryId, totalCentavos: pesos * 100, count };
}

let nextId = 1;
function entry(pesos: number, categoryId: string, description: string, spentOn: string): Entry {
  const id = nextId++;
  return {
    id,
    chatId: -1001,
    sourceMessageId: id,
    itemIndex: 0,
    confirmationMessageId: null,
    payerUserId: 1001,
    amountCentavos: pesos * 100,
    currency: "PHP",
    description,
    categoryId,
    categorySource: "keyword",
    spentOn,
    rawText: `${description} ${pesos}`,
    parser: "rules",
    checkAmount: false,
    createdAt: "2026-09-29T02:00:00.000Z",
    createdBy: 1001,
    updatedAt: "2026-09-29T02:00:00.000Z",
    updatedBy: 1001,
    deletedAt: null,
    deletedBy: null,
    sourceEditedAt: null,
  };
}

const EXAMPLE_WEEK = buildReport([
  total("groceries", 3200, 5),
  total("dining", 2150, 6),
  total("transfer", 2000, 1),
  total("transport", 1300, 5),
  total("bills", 1100, 4),
  total("other", 700, 3),
]);

describe("The system SHALL send a weekly digest on Sunday at 19:00", () => {
  it("Happy path — the digest of a week", () => {
    expect(weeklyDigestText(WEEK, EXAMPLE_WEEK, 310000)).toBe(
      [
        "📊 Weekly digest · Sep 28 to Oct 4",
        "₱8,450 · 23 entries",
        "",
        "🛒 Groceries · ₱3,200 · 38%",
        "🍽 Dining · ₱2,150 · 25%",
        "🚗 Transport · ₱1,300 · 15%",
        "💡 Bills · ₱1,100 · 13%",
        "❓ Other · ₱700 · 8%",
        "",
        "Not counted: 🔁 Transfers ₱2,000",
        "",
        "Month to date: ₱3,100",
      ].join("\n"),
    );
  });

  it("Edge case — a week without entries", () => {
    expect(weeklyDigestText(WEEK, buildReport([]), 0)).toBe(
      "🌱 Nothing logged for Sep 28 to Oct 4. A fresh week starts tomorrow.",
    );
  });

  it("Edge case — a late run covers its own week", () => {
    const text = weeklyDigestText(WEEK, buildReport([total("dining", 250)]), 25000);
    expect(text).toBe(
      ["📊 Weekly digest · Sep 28 to Oct 4", "₱250 · 1 entry", "", "🍽 Dining · ₱250 · 100%", "", "Month to date: ₱250"].join(
        "\n",
      ),
    );
  });

  it("Edge case — the month to date starts on the 1st", () => {
    const report = buildReport([total("groceries", 5000), total("dining", 300)]);
    expect(weeklyDigestText(WEEK, report, 30000)).toBe(
      [
        "📊 Weekly digest · Sep 28 to Oct 4",
        "₱5,300 · 2 entries",
        "",
        "🛒 Groceries · ₱5,000 · 94%",
        "🍽 Dining · ₱300 · 6%",
        "",
        "Month to date: ₱300",
      ].join("\n"),
    );
  });

  it("Edge case — only entries that are not counted, and a month to date of nothing", () => {
    expect(weeklyDigestText(WEEK, buildReport([total("transfer", 2000)]), 0)).toBe(
      ["📊 Weekly digest · Sep 28 to Oct 4", "₱0 · 0 entries", "", "Not counted: 🔁 Transfers ₱2,000", "", "Month to date: ₱0"].join(
        "\n",
      ),
    );
  });
});

describe("The system SHALL send a monthly recap on the 1st at 08:00", () => {
  it("Happy path — the recap of a month", () => {
    const report = buildReport([
      total("housing", 12000),
      total("transfer", 5000),
      total("bills", 3200),
      total("groceries", 2340),
      total("dining", 250),
      total("transport", 180),
      total("other", 150),
    ]);
    const top = [
      entry(12000, "housing", "rent", "2026-09-01"),
      entry(3200, "bills", "meralco", "2026-09-27"),
      entry(2340, "groceries", "groceries gcash", "2026-09-29"),
      entry(250, "dining", "lunch", "2026-09-29"),
      entry(180, "transport", "grab", "2026-09-29"),
    ];
    expect(monthlyRecapText(SEPTEMBER, report, top, 4)).toBe(
      [
        "📊 September 2026",
        "₱18,120 · 6 entries",
        "",
        "🏠 Housing · ₱12,000 · 66%",
        "💡 Bills · ₱3,200 · 18%",
        "🛒 Groceries · ₱2,340 · 13%",
        "🍽 Dining · ₱250 · 1%",
        "🚗 Transport · ₱180 · 1%",
        "❓ Other · ₱150 · 1%",
        "",
        "Not counted: 🔁 Transfers ₱5,000",
        "",
        "Top entries",
        "1. ₱12,000 · 🏠 Housing · rent · Sep 1",
        "2. ₱3,200 · 💡 Bills · meralco · Sep 27",
        "3. ₱2,340 · 🛒 Groceries · groceries gcash · Sep 29",
        "4. ₱250 · 🍽 Dining · lunch · Sep 29",
        "5. ₱180 · 🚗 Transport · grab · Sep 29",
        "",
        "Daily average: ₱604",
        "Days with entries: 4 of 30",
      ].join("\n"),
    );
  });

  it("Edge case — a month without entries", () => {
    expect(monthlyRecapText(SEPTEMBER, buildReport([]), [], 0)).toBe("🌱 Nothing logged in September 2026.");
  });

  it("Edge case — the recap of December", () => {
    const december = { from: "2026-12-01", to: "2026-12-31" };
    expect(
      monthlyRecapText(december, buildReport([total("dining", 310)]), [entry(310, "dining", "noche buena", "2026-12-24")], 1),
    ).toBe(
      [
        "📊 December 2026",
        "₱310 · 1 entry",
        "",
        "🍽 Dining · ₱310 · 100%",
        "",
        "Top entries",
        "1. ₱310 · 🍽 Dining · noche buena · Dec 24",
        "",
        "Daily average: ₱10",
        "Days with entries: 1 of 31",
      ].join("\n"),
    );
  });

  it("Edge case — a half peso is rounded up, and February is short", () => {
    const february = { from: "2027-02-01", to: "2027-02-28" };
    expect(
      monthlyRecapText(february, buildReport([total("dining", 14)]), [entry(14, "dining", "candy", "2027-02-10")], 1),
    ).toBe(
      [
        "📊 February 2027",
        "₱14 · 1 entry",
        "",
        "🍽 Dining · ₱14 · 100%",
        "",
        "Top entries",
        "1. ₱14 · 🍽 Dining · candy · Feb 10",
        "",
        "Daily average: ₱1",
        "Days with entries: 1 of 28",
      ].join("\n"),
    );
  });

  it("Edge case — only entries that are not counted", () => {
    expect(monthlyRecapText(SEPTEMBER, buildReport([total("transfer", 5000)]), [], 1)).toBe(
      [
        "📊 September 2026",
        "₱0 · 0 entries",
        "",
        "Not counted: 🔁 Transfers ₱5,000",
        "",
        "Daily average: ₱0",
        "Days with entries: 1 of 30",
      ].join("\n"),
    );
  });

  it("an empty description is left out, and a long one is shortened", () => {
    const long = "x".repeat(61);
    const report = buildReport([total("dining", 300, 2)]);
    const top = [entry(200, "dining", "", "2026-09-05"), entry(100, "dining", long, "2026-09-06")];
    expect(monthlyRecapText(SEPTEMBER, report, top, 2)).toBe(
      [
        "📊 September 2026",
        "₱300 · 2 entries",
        "",
        "🍽 Dining · ₱300 · 100%",
        "",
        "Top entries",
        "1. ₱200 · 🍽 Dining · Sep 5",
        `2. ₱100 · 🍽 Dining · ${"x".repeat(59)}… · Sep 6`,
        "",
        "Daily average: ₱10",
        "Days with entries: 2 of 30",
      ].join("\n"),
    );
  });
});
