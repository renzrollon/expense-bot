import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addMessageEntries, softDeleteEntry, type NewEntryItem } from "../src/ledger";
import { loadReport } from "../src/reports/build";
import { MEMBER_A } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";

useCleanTables(env.DB);

const db = env.DB;
const NOW = new Date("2026-09-29T02:00:00.000Z");
let nextMessageId = 1;

function item(overrides: Partial<NewEntryItem> = {}): NewEntryItem {
  return {
    amountCentavos: 25000,
    description: "lunch",
    spentOn: "2026-09-29",
    categoryId: "dining",
    categorySource: "keyword",
    checkAmount: false,
    ...overrides,
  };
}

async function store(overrides: Partial<NewEntryItem> = {}) {
  const result = await addMessageEntries(db, {
    chatId: -1001,
    sourceMessageId: nextMessageId++,
    payerUserId: MEMBER_A.id,
    byUserId: MEMBER_A.id,
    rawText: "lunch 250",
    parser: "rules",
    now: NOW,
    items: [item(overrides)],
  });
  return result.entries[0]!;
}

describe("The system SHALL total a period by category", () => {
  it("Failure — a malformed period is rejected", async () => {
    await expect(loadReport(db, { from: "2026/09/28", to: "2026-09-29" })).rejects.toBeInstanceOf(RangeError);
  });

  it("Edge case — a removed entry counts nowhere", async () => {
    await store({ amountCentavos: 320000, categoryId: "groceries" });
    const other = await store({ amountCentavos: 70000, categoryId: "other", spentOn: "2026-09-28" });
    await softDeleteEntry(db, { id: other.id, byUserId: MEMBER_A.id, now: NOW });
    const report = await loadReport(db, { from: "2026-09-28", to: "2026-09-29" });
    expect(report.totalCentavos).toBe(320000);
    expect(report.count).toBe(1);
    expect(report.lines.map((line) => line.categoryId)).toEqual(["groceries"]);
  });

  it("Edge case — an entry counts on its spent-on date", async () => {
    await store({ spentOn: "2026-09-28" });
    const yesterday = await loadReport(db, { from: "2026-09-28", to: "2026-09-28" });
    const today = await loadReport(db, { from: "2026-09-29", to: "2026-09-29" });
    expect(yesterday.count).toBe(1);
    expect(yesterday.totalCentavos).toBe(25000);
    expect(today.empty).toBe(true);
  });
});
