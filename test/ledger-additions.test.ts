import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  addMessageEntries,
  countActiveEntries,
  countDaysWithEntries,
  findRemovalAt,
  getEntry,
  largestEntries,
  listBackupEntries,
  markSourceEdited,
  restoreEntry,
  setEntryCategory,
  softDeleteEntry,
  type Entry,
  type NewEntryItem,
  type NewMessageEntries,
} from "../src/ledger";
import { MEMBER_A, MEMBER_B } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";

useCleanTables(env.DB);

const db = env.DB;
const NOW = new Date("2026-09-29T10:00:00.000Z");
const CHAT = -1001;
const ANA = MEMBER_A.id;
const BEN = MEMBER_B.id;
const UNKNOWN_ID = 424242;
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

let nextMessageId = 100;

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

function write(overrides: Partial<NewMessageEntries> = {}): NewMessageEntries {
  return {
    chatId: CHAT,
    sourceMessageId: nextMessageId++,
    payerUserId: ANA,
    byUserId: ANA,
    rawText: "lunch 250",
    parser: "rules",
    now: NOW,
    items: [item()],
    ...overrides,
  };
}

/** Stores a one-item message and returns its entry. */
async function storeOne(
  itemOverrides: Partial<NewEntryItem> = {},
  overrides: Partial<NewMessageEntries> = {},
): Promise<Entry> {
  const result = await addMessageEntries(db, write({ items: [item(itemOverrides)], ...overrides }));
  expect(result.entries).toHaveLength(1);
  return result.entries[0]!;
}

async function remove(id: number, by: number, at: Date): Promise<void> {
  const result = await softDeleteEntry(db, { id, byUserId: by, now: at });
  expect(result.outcome).toBe("changed");
}

/** A database on which every statement fails, so a call that sends one fails with the injected error. */
function silentDb(): D1Database {
  const failing = failingDb(env.DB);
  failing.failAll();
  return failing.db;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function expectRangeError(promise: Promise<unknown>): Promise<void> {
  expect(await rejection(promise)).toBeInstanceOf(RangeError);
}

describe("Entry by id", () => {
  it("Happy path — find an entry by its id", async () => {
    const stored = await storeOne({}, { sourceMessageId: 10 });
    const found = await getEntry(db, stored.id);
    expect(found).toEqual(stored);
    expect(found?.sourceMessageId).toBe(10);
    expect(found?.amountCentavos).toBe(25000);
  });

  it("Failure — an unknown id", async () => {
    expect(await getEntry(db, UNKNOWN_ID)).toBeNull();
  });

  it("Edge case — a removed entry is still found", async () => {
    const stored = await storeOne();
    const removedAt = new Date("2026-09-29T11:00:00.000Z");
    await remove(stored.id, BEN, removedAt);
    const found = await getEntry(db, stored.id);
    expect(found?.id).toBe(stored.id);
    expect(found?.deletedAt).toBe(removedAt.toISOString());
    expect(found?.deletedBy).toBe(BEN);
  });

  it("Edge case — a value that is not an id", async () => {
    const silent = silentDb();
    for (const id of [0, -1, 1.5]) {
      expect(await getEntry(silent, id)).toBeNull();
    }
  });
});

describe("Edit mark of a source message", () => {
  function message11(): NewMessageEntries {
    return write({
      sourceMessageId: 11,
      rawText: "grab 180, groceries 2340 gcash",
      items: [
        item({ amountCentavos: 18000, description: "grab", categoryId: "transport" }),
        item({ amountCentavos: 234000, description: "groceries gcash", categoryId: "groceries" }),
      ],
    });
  }

  it("Happy path — mark an edited message", async () => {
    const stored = await addMessageEntries(db, message11());
    const marked = await markSourceEdited(db, CHAT, 11, new Date("2026-09-29T11:00:00.000Z"));
    expect(marked).toEqual(
      stored.entries.map((entry) => ({ ...entry, sourceEditedAt: "2026-09-29T11:00:00.000Z" })),
    );
    expect(marked.map((entry) => entry.itemIndex)).toEqual([0, 1]);
    for (const entry of marked) {
      expect(entry.updatedAt).toBe("2026-09-29T10:00:00.000Z");
      expect(entry.updatedBy).toBe(ANA);
    }
  });

  it("Failure — a message with no entries", async () => {
    expect(await markSourceEdited(db, CHAT, 99, new Date("2026-09-29T11:00:00.000Z"))).toEqual([]);
    const row = await db.prepare("SELECT COUNT(*) AS n FROM expenses").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("Edge case — a second mark keeps the first time", async () => {
    await addMessageEntries(db, message11());
    await markSourceEdited(db, CHAT, 11, new Date("2026-09-29T11:00:00.000Z"));
    const again = await markSourceEdited(db, CHAT, 11, new Date("2026-09-29T12:00:00.000Z"));
    expect(again.map((entry) => entry.sourceEditedAt)).toEqual([
      "2026-09-29T11:00:00.000Z",
      "2026-09-29T11:00:00.000Z",
    ]);
  });

  it("Edge case — a new entry has no edit time", async () => {
    const stored = await addMessageEntries(db, message11());
    expect(stored.entries.map((entry) => entry.sourceEditedAt)).toEqual([null, null]);
  });
});

describe("Largest entries in a period", () => {
  it("Happy path — the two largest of three", async () => {
    const rent = await storeOne({ amountCentavos: 1_200_000, description: "rent", spentOn: "2026-09-01" });
    const meralco = await storeOne({ amountCentavos: 320_000, description: "meralco", spentOn: "2026-09-05" });
    await storeOne({ amountCentavos: 25_000, description: "lunch", spentOn: "2026-09-10" });
    const result = await largestEntries(db, SEPTEMBER, { limit: 2, excludeCategoryIds: [] });
    expect(result.map((entry) => entry.id)).toEqual([rent.id, meralco.id]);
  });

  it("Failure — a malformed date or limit is rejected", async () => {
    const silent = silentDb();
    await expectRangeError(largestEntries(silent, { from: "2026/09/01", to: "2026-09-30" }, { limit: 2 }));
    for (const limit of [0, 51, 2.5]) {
      await expectRangeError(largestEntries(silent, SEPTEMBER, { limit }));
    }
  });

  it("Edge case — equal amounts", async () => {
    const e5 = await storeOne({ amountCentavos: 50_000, spentOn: "2026-09-10" });
    const e6 = await storeOne({ amountCentavos: 50_000, spentOn: "2026-09-03" });
    const e7 = await storeOne({ amountCentavos: 50_000, spentOn: "2026-09-03" });
    const result = await largestEntries(db, SEPTEMBER, { limit: 3 });
    expect(result.map((entry) => entry.id)).toEqual([e6.id, e7.id, e5.id]);
  });

  it("Edge case — removed and left-out entries", async () => {
    const gone = await storeOne({ amountCentavos: 900_000, spentOn: "2026-09-04" });
    await remove(gone.id, ANA, new Date("2026-09-29T11:00:00.000Z"));
    await storeOne({ amountCentavos: 2_000_000, categoryId: "transfer", spentOn: "2026-09-05" });
    const dining = await storeOne({ amountCentavos: 25_000, categoryId: "dining", spentOn: "2026-09-06" });
    const result = await largestEntries(db, SEPTEMBER, { limit: 5, excludeCategoryIds: ["transfer"] });
    expect(result.map((entry) => entry.id)).toEqual([dining.id]);
  });
});

describe("Days with entries in a period", () => {
  it("Happy path — three entries on two days", async () => {
    await storeOne({ spentOn: "2026-09-03" });
    await storeOne({ spentOn: "2026-09-03" });
    await storeOne({ spentOn: "2026-09-10" });
    expect(await countDaysWithEntries(db, SEPTEMBER)).toBe(2);
  });

  it("Failure — a malformed date is rejected", async () => {
    await expectRangeError(countDaysWithEntries(silentDb(), { from: "2026-09-01", to: "30 Sep 2026" }));
  });

  it("Edge case — a day whose entries were all removed", async () => {
    const gone = await storeOne({ spentOn: "2026-09-03" });
    await remove(gone.id, ANA, new Date("2026-09-29T11:00:00.000Z"));
    await storeOne({ spentOn: "2026-09-10" });
    expect(await countDaysWithEntries(db, SEPTEMBER)).toBe(1);
  });

  it("Edge case — an empty period", async () => {
    await storeOne({ spentOn: "2026-08-15" });
    expect(await countDaysWithEntries(db, SEPTEMBER)).toBe(0);
  });
});

describe("Active entries in a period", () => {
  it("Happy path — entries inside the period, both end dates included", async () => {
    await storeOne({ spentOn: "2026-08-31" });
    await storeOne({ spentOn: "2026-09-01" });
    await storeOne({ spentOn: "2026-09-30" });
    await storeOne({ spentOn: "2026-10-01" });
    expect(await countActiveEntries(db, SEPTEMBER)).toBe(2);
  });

  it("Failure — a malformed date is rejected", async () => {
    await expectRangeError(countActiveEntries(silentDb(), { from: "2026-09-01", to: "30 Sep 2026" }));
  });

  it("Edge case — removed entries are not counted", async () => {
    const gone = await storeOne({ spentOn: "2026-09-03" });
    await remove(gone.id, ANA, new Date("2026-09-29T11:00:00.000Z"));
    await storeOne({ spentOn: "2026-09-10" });
    expect(await countActiveEntries(db, SEPTEMBER)).toBe(1);
  });

  it("Edge case — an empty ledger", async () => {
    expect(await countActiveEntries(db, SEPTEMBER)).toBe(0);
  });
});

describe("Entries for a backup window", () => {
  const WINDOW = { datedFrom: "2026-08-01", changedSince: "2026-08-01T00:00:00.000Z" };

  /** Stores an entry dated `spentOn`, created and last changed at 10:00 UTC that day. */
  function storeDated(spentOn: string): Promise<Entry> {
    return storeOne({ spentOn }, { now: new Date(`${spentOn}T10:00:00.000Z`) });
  }

  it("Happy path — entries dated inside the window", async () => {
    await storeDated("2026-07-31");
    const august = await storeDated("2026-08-01");
    const september = await storeDated("2026-09-15");
    const result = await listBackupEntries(db, WINDOW);
    expect(result.map((entry) => entry.id)).toEqual([august.id, september.id]);
  });

  it("Failure — a malformed first date is rejected", async () => {
    await expectRangeError(
      listBackupEntries(silentDb(), { datedFrom: "1 Aug 2026", changedSince: "2026-08-01T00:00:00.000Z" }),
    );
  });

  it("Edge case — an older entry that was changed inside the window", async () => {
    const changed = await storeDated("2026-06-10");
    await storeDated("2026-06-11");
    const result = await setEntryCategory(db, {
      id: changed.id,
      byUserId: ANA,
      now: new Date("2026-09-20T03:00:00.000Z"),
      categoryId: "groceries",
      categorySource: "manual",
    });
    expect(result.outcome).toBe("changed");
    const listed = await listBackupEntries(db, WINDOW);
    expect(listed.map((entry) => entry.id)).toEqual([changed.id]);
  });

  it("Edge case — removed entries are listed, once", async () => {
    const entry = await storeDated("2026-09-15");
    await remove(entry.id, ANA, new Date("2026-09-16T01:00:00.000Z"));
    const listed = await listBackupEntries(db, WINDOW);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(entry.id);
    expect(listed[0]!.deletedAt).toBe("2026-09-16T01:00:00.000Z");
  });
});

describe("A member's removal at a given time", () => {
  const REMOVED_AT = new Date("2026-09-29T02:05:00.000Z");

  it("Happy path — find the removal", async () => {
    const entry = await storeOne();
    await remove(entry.id, ANA, REMOVED_AT);
    const found = await findRemovalAt(db, ANA, REMOVED_AT);
    expect(found?.id).toBe(entry.id);
  });

  it("Failure — no removal matches", async () => {
    const entry = await storeOne();
    await remove(entry.id, ANA, REMOVED_AT);
    expect(await findRemovalAt(db, BEN, REMOVED_AT)).toBeNull();
    expect(await findRemovalAt(db, ANA, new Date("2026-09-29T02:05:01.000Z"))).toBeNull();
  });

  it("Edge case — a restored entry no longer matches", async () => {
    const entry = await storeOne();
    await remove(entry.id, ANA, REMOVED_AT);
    const restored = await restoreEntry(db, {
      id: entry.id,
      byUserId: BEN,
      now: new Date("2026-09-29T02:06:00.000Z"),
    });
    expect(restored.outcome).toBe("changed");
    expect(await findRemovalAt(db, ANA, REMOVED_AT)).toBeNull();
  });
});
