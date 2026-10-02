import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  addMessageEntries,
  attachConfirmation,
  countActiveEntriesOn,
  findEntriesBySourceMessage,
  findLatestActiveEntry,
  listEntries,
  restoreEntry,
  setEntryCategory,
  softDeleteEntry,
  totalsByCategory,
  type AddResult,
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
const SUPERGROUP = -1002;
const ANA = MEMBER_A.id;
const BEN = MEMBER_B.id;
const UNKNOWN_ID = 424242;

function later(ms: number, from: Date = NOW): Date {
  return new Date(from.getTime() + ms);
}

const MINUTE = 60_000;

interface ExpenseRow {
  id: number;
  chat_id: number;
  source_message_id: number;
  item_index: number;
  confirmation_message_id: number | null;
  payer_user_id: number;
  amount_centavos: number;
  currency: string;
  description: string;
  category_id: string;
  category_source: string;
  spent_on: string;
  raw_text: string;
  parser: string;
  check_amount: number;
  created_at: string;
  created_by: number;
  updated_at: string;
  updated_by: number;
  deleted_at: string | null;
  deleted_by: number | null;
}

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
    sourceMessageId: 10,
    payerUserId: ANA,
    byUserId: ANA,
    rawText: "lunch 250",
    parser: "rules",
    now: NOW,
    items: [item()],
    ...overrides,
  };
}

/** Message 11 of the spec: `grab 180, groceries 2340 gcash`. */
function message11(overrides: Partial<NewMessageEntries> = {}): NewMessageEntries {
  return write({
    sourceMessageId: 11,
    rawText: "grab 180, groceries 2340 gcash",
    items: [
      item({ amountCentavos: 18000, description: "grab", categoryId: "transport" }),
      item({ amountCentavos: 234000, description: "groceries gcash", categoryId: "groceries" }),
    ],
    ...overrides,
  });
}

async function store(overrides: Partial<NewMessageEntries> = {}): Promise<AddResult> {
  return addMessageEntries(db, write(overrides));
}

/** Stores a one-item message and returns its entry. */
async function storeOne(
  overrides: Partial<NewMessageEntries> = {},
  itemOverrides: Partial<NewEntryItem> = {},
): Promise<Entry> {
  const result = await addMessageEntries(db, write({ items: [item(itemOverrides)], ...overrides }));
  expect(result.entries).toHaveLength(1);
  return result.entries[0]!;
}

async function rowsOf(chatId: number, sourceMessageId: number): Promise<ExpenseRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM expenses WHERE chat_id = ? AND source_message_id = ? ORDER BY item_index")
    .bind(chatId, sourceMessageId)
    .all<ExpenseRow>();
  return results;
}

async function allRows(): Promise<ExpenseRow[]> {
  const { results } = await db.prepare("SELECT * FROM expenses ORDER BY id").all<ExpenseRow>();
  return results;
}

/** Removes an entry with raw SQL, as the ledger's soft delete would. */
async function removeDirectly(id: number, by: number, at: Date): Promise<void> {
  await db
    .prepare("UPDATE expenses SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(at.toISOString(), by, at.toISOString(), by, id)
    .run();
}

/** Restores an entry with raw SQL, as the ledger's restore would. */
async function restoreDirectly(id: number, by: number, at: Date): Promise<void> {
  await db
    .prepare("UPDATE expenses SET deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(at.toISOString(), by, id)
    .run();
}

function removed(entry: Entry, by: number, at: Date): Entry {
  return {
    ...entry,
    deletedAt: at.toISOString(),
    deletedBy: by,
    updatedAt: at.toISOString(),
    updatedBy: by,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * Makes the write against a database on which every statement fails, and
 * expects a RangeError naming the field. A write that sent any statement would
 * fail with the injected D1 error instead. Then expects no stored entry.
 */
async function expectRejected(input: NewMessageEntries, field: string): Promise<void> {
  const failing = failingDb(env.DB);
  failing.failAll();
  const error = await rejection(addMessageEntries(failing.db, input));
  expect(error).toBeInstanceOf(RangeError);
  expect((error as Error).message).toContain(field);
  expect(await allRows()).toEqual([]);
}

const PERIOD = { from: "2026-09-28", to: "2026-10-04" };

describe("Entry record", () => {
  it("A stored entry holds every field", async () => {
    const result = await store();
    expect(result.created).toBe(true);
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0]!;
    expect(Number.isInteger(entry.id)).toBe(true);
    expect(entry.id).toBeGreaterThan(0);
    expect(entry).toEqual({
      id: entry.id,
      chatId: CHAT,
      sourceMessageId: 10,
      itemIndex: 0,
      confirmationMessageId: null,
      payerUserId: ANA,
      amountCentavos: 25000,
      currency: "PHP",
      description: "lunch",
      categoryId: "dining",
      categorySource: "keyword",
      spentOn: "2026-09-29",
      rawText: "lunch 250",
      parser: "rules",
      checkAmount: false,
      createdAt: "2026-09-29T10:00:00.000Z",
      createdBy: ANA,
      updatedAt: "2026-09-29T10:00:00.000Z",
      updatedBy: ANA,
      deletedAt: null,
      deletedBy: null,
      sourceEditedAt: null,
    });
    expect(await rowsOf(CHAT, 10)).toEqual([
      {
        id: entry.id,
        chat_id: CHAT,
        source_message_id: 10,
        item_index: 0,
        confirmation_message_id: null,
        payer_user_id: ANA,
        amount_centavos: 25000,
        currency: "PHP",
        description: "lunch",
        category_id: "dining",
        category_source: "keyword",
        spent_on: "2026-09-29",
        raw_text: "lunch 250",
        parser: "rules",
        check_amount: 0,
        created_at: "2026-09-29T10:00:00.000Z",
        created_by: ANA,
        updated_at: "2026-09-29T10:00:00.000Z",
        updated_by: ANA,
        deleted_at: null,
        deleted_by: null,
        source_edited_at: null,
      },
    ]);
  });
});

describe("A message's items are stored together, once", () => {
  it("Two items from one message", async () => {
    const result = await addMessageEntries(db, message11());
    expect(result.created).toBe(true);
    expect(
      result.entries.map((e) => [e.itemIndex, e.amountCentavos, e.description, e.categoryId, e.rawText]),
    ).toEqual([
      [0, 18000, "grab", "transport", "grab 180, groceries 2340 gcash"],
      [1, 234000, "groceries gcash", "groceries", "grab 180, groceries 2340 gcash"],
    ]);
    const rows = await rowsOf(CHAT, 11);
    expect(rows.map((row) => [row.item_index, row.amount_centavos, row.raw_text])).toEqual([
      [0, 18000, "grab 180, groceries 2340 gcash"],
      [1, 234000, "grab 180, groceries 2340 gcash"],
    ]);
    expect(rows.map((row) => row.id)).toEqual(result.entries.map((e) => e.id));
  });

  it("The same message is stored twice", async () => {
    const first = await store();
    const second = await store({ now: later(5_000) });
    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, entries: first.entries });
    const rows = await rowsOf(CHAT, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.created_at).toBe("2026-09-29T10:00:00.000Z");
    expect(await allRows()).toHaveLength(1);
  });

  it("A repeated write with different items changes nothing", async () => {
    const first = await store();
    const before = await rowsOf(CHAT, 10);
    const second = await store({
      now: later(5_000),
      items: [item({ amountCentavos: 999 }), item({ amountCentavos: 12345, description: "coffee" })],
    });
    expect(second).toEqual({ created: false, entries: first.entries });
    expect(await rowsOf(CHAT, 10)).toEqual(before);
    expect(await allRows()).toHaveLength(1);
  });

  it("A removed entry is not stored again", async () => {
    const entry = await storeOne();
    await removeDirectly(entry.id, ANA, later(MINUTE));
    const again = await store({ now: later(2 * MINUTE) });
    expect(again).toEqual({ created: false, entries: [removed(entry, ANA, later(MINUTE))] });
    expect(await allRows()).toHaveLength(1);
  });

  it("The same message id in another chat is another message", async () => {
    const first = await store({ chatId: CHAT });
    const second = await store({ chatId: SUPERGROUP });
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.entries[0]!.id).not.toBe(first.entries[0]!.id);
    expect(await rowsOf(CHAT, 10)).toHaveLength(1);
    expect(await rowsOf(SUPERGROUP, 10)).toHaveLength(1);
  });

  it("One item fails to store", async () => {
    const failing = failingDb(env.DB);
    failing.failInsideBatch((_sql, position) => position === 1);
    await expect(addMessageEntries(failing.db, message11())).rejects.toThrow(/malformed JSON/);
    expect(await rowsOf(CHAT, 11)).toEqual([]);

    failing.heal();
    const again = await addMessageEntries(failing.db, message11());
    expect(again.created).toBe(true);
    expect((await rowsOf(CHAT, 11)).map((row) => [row.item_index, row.amount_centavos])).toEqual([
      [0, 18000],
      [1, 234000],
    ]);
  });
});

describe("Invalid writes are rejected", () => {
  it.each([
    { label: "0", amount: 0 },
    { label: "-100", amount: -100 },
    { label: "250.5", amount: 250.5 },
    { label: "1,000,000,000", amount: 1_000_000_000 },
  ])("Amounts that are rejected: $label", async ({ amount }) => {
    await expectRejected(write({ items: [item(), item({ amountCentavos: amount })] }), "amountCentavos");
  });

  it("Amounts at the limits are stored", async () => {
    const result = await store({ items: [item({ amountCentavos: 1 }), item({ amountCentavos: 999_999_999 })] });
    expect(result.created).toBe(true);
    expect((await rowsOf(CHAT, 10)).map((row) => row.amount_centavos)).toEqual([1, 999_999_999]);
  });

  it.each([
    { label: "11 items", items: Array.from({ length: 11 }, (_, i) => item({ amountCentavos: 100 + i })) },
    { label: "no items", items: [] as NewEntryItem[] },
  ])("Too many or too few items: $label", async ({ items }) => {
    await expectRejected(write({ items }), "items");
  });

  it.each([
    { label: "spent-on 29/09/2026", input: write({ items: [item({ spentOn: "29/09/2026" })] }), field: "spentOn" },
    { label: "empty category id", input: write({ items: [item({ categoryId: "" })] }), field: "categoryId" },
    {
      label: "category source guess",
      input: write({ items: [item({ categorySource: "guess" as NewEntryItem["categorySource"] })] }),
      field: "categorySource",
    },
    {
      label: "parser magic",
      input: write({ parser: "magic" as NewMessageEntries["parser"] }),
      field: "parser",
    },
  ])("A date, a category or a source that is not valid: $label", async ({ input, field }) => {
    await expectRejected(input, field);
  });

  it.each([
    { label: "amount 0", input: write({ items: [item({ amountCentavos: 0 })] }) },
    { label: "no items", input: write({ items: [] }) },
    { label: "spent-on 29/09/2026", input: write({ items: [item({ spentOn: "29/09/2026" })] }) },
    { label: "parser magic", input: write({ parser: "magic" as NewMessageEntries["parser"] }) },
  ])("An invalid write never reaches the database: $label", async ({ input }) => {
    const failing = failingDb(env.DB);
    failing.failAll();
    const error = await rejection(addMessageEntries(failing.db, input));
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).not.toMatch(/D1 failure injected/);
  });

  const BASELINE: Omit<ExpenseRow, "id"> = {
    chat_id: CHAT,
    source_message_id: 10,
    item_index: 0,
    confirmation_message_id: null,
    payer_user_id: ANA,
    amount_centavos: 25000,
    currency: "PHP",
    description: "lunch",
    category_id: "dining",
    category_source: "keyword",
    spent_on: "2026-09-29",
    raw_text: "lunch 250",
    parser: "rules",
    check_amount: 0,
    created_at: NOW.toISOString(),
    created_by: ANA,
    updated_at: NOW.toISOString(),
    updated_by: ANA,
    deleted_at: null,
    deleted_by: null,
  };

  async function insertDirectly(row: Omit<ExpenseRow, "id">): Promise<void> {
    const columns = Object.keys(row);
    await db
      .prepare(`INSERT INTO expenses (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .bind(...Object.values(row))
      .run();
  }

  const CHECK_FAILED = /CHECK constraint failed/;
  const UNIQUE_FAILED =
    /UNIQUE constraint failed: expenses\.chat_id, expenses\.source_message_id, expenses\.item_index/;

  it.each([
    { label: "amount 0", row: { source_message_id: 20, amount_centavos: 0 }, refusal: CHECK_FAILED },
    { label: "category source guess", row: { source_message_id: 20, category_source: "guess" }, refusal: CHECK_FAILED },
    { label: "parser magic", row: { source_message_id: 20, parser: "magic" }, refusal: CHECK_FAILED },
    {
      label: "removal time and no remover",
      row: { source_message_id: 20, deleted_at: NOW.toISOString() },
      refusal: CHECK_FAILED,
    },
    { label: "same chat, message and item index", row: {}, refusal: UNIQUE_FAILED },
  ])("The table refuses invalid entries written directly: $label", async ({ row, refusal }) => {
    await expect(insertDirectly(BASELINE)).resolves.toBeUndefined();
    await expect(insertDirectly({ ...BASELINE, ...row })).rejects.toThrow(refusal);
    expect(await allRows()).toHaveLength(1);
  });
});

describe("Confirmation message id", () => {
  it("Attach a confirmation", async () => {
    const { entries } = await addMessageEntries(db, message11());
    expect(await attachConfirmation(db, CHAT, 11, 900)).toBe(2);
    const rows = await rowsOf(CHAT, 11);
    expect(rows.map((row) => [row.confirmation_message_id, row.updated_at, row.updated_by])).toEqual([
      [900, NOW.toISOString(), ANA],
      [900, NOW.toISOString(), ANA],
    ]);
    expect(await findEntriesBySourceMessage(db, CHAT, 11)).toEqual(
      entries.map((e) => ({ ...e, confirmationMessageId: 900 })),
    );
  });

  it("A second confirmation id is ignored", async () => {
    await addMessageEntries(db, message11());
    expect(await attachConfirmation(db, CHAT, 11, 900)).toBe(2);
    expect(await attachConfirmation(db, CHAT, 11, 901)).toBe(0);
    expect((await rowsOf(CHAT, 11)).map((row) => row.confirmation_message_id)).toEqual([900, 900]);
  });
});

describe("Entries of a source message", () => {
  it("Find the entries of a message", async () => {
    const { entries } = await addMessageEntries(db, message11());
    await removeDirectly(entries[1]!.id, ANA, later(MINUTE));
    expect(await findEntriesBySourceMessage(db, CHAT, 11)).toEqual([
      entries[0],
      removed(entries[1]!, ANA, later(MINUTE)),
    ]);
  });

  it("A message with no entries", async () => {
    await store();
    expect(await findEntriesBySourceMessage(db, CHAT, 99)).toEqual([]);
  });
});

describe("Soft delete", () => {
  it("Remove an entry", async () => {
    const entry = await storeOne();
    const at = new Date("2026-09-29T11:00:00.000Z");
    const expected = removed(entry, BEN, at);
    expect(await softDeleteEntry(db, { id: entry.id, byUserId: BEN, now: at })).toEqual({
      outcome: "changed",
      entry: expected,
    });
    expect(await findEntriesBySourceMessage(db, CHAT, 10)).toEqual([expected]);
    expect((await allRows())[0]).toMatchObject({
      deleted_at: "2026-09-29T11:00:00.000Z",
      deleted_by: BEN,
      updated_at: "2026-09-29T11:00:00.000Z",
      updated_by: BEN,
    });
  });

  it("Remove twice", async () => {
    const entry = await storeOne();
    const first = new Date("2026-09-29T11:00:00.000Z");
    await softDeleteEntry(db, { id: entry.id, byUserId: ANA, now: first });
    const expected = removed(entry, ANA, first);
    expect(
      await softDeleteEntry(db, { id: entry.id, byUserId: BEN, now: new Date("2026-09-29T11:30:00.000Z") }),
    ).toEqual({ outcome: "unchanged", entry: expected });
    expect(await findEntriesBySourceMessage(db, CHAT, 10)).toEqual([expected]);
  });

  it("Remove an unknown entry", async () => {
    await store();
    expect(await softDeleteEntry(db, { id: UNKNOWN_ID, byUserId: ANA, now: NOW })).toEqual({
      outcome: "not_found",
    });
  });
});

describe("Restore", () => {
  it("Restore brings the entry back unchanged", async () => {
    const stored = await storeOne();
    await attachConfirmation(db, CHAT, 10, 900);
    const before = { ...stored, confirmationMessageId: 900 };
    await softDeleteEntry(db, { id: stored.id, byUserId: BEN, now: new Date("2026-09-29T11:00:00.000Z") });
    const at = new Date("2026-09-29T11:30:00.000Z");
    const expected: Entry = { ...before, updatedAt: at.toISOString(), updatedBy: ANA };
    expect(await restoreEntry(db, { id: stored.id, byUserId: ANA, now: at })).toEqual({
      outcome: "changed",
      entry: expected,
    });
    expect(await findEntriesBySourceMessage(db, CHAT, 10)).toEqual([expected]);
  });

  it("Restore an active entry", async () => {
    const entry = await storeOne();
    const before = await allRows();
    expect(await restoreEntry(db, { id: entry.id, byUserId: BEN, now: later(MINUTE) })).toEqual({
      outcome: "unchanged",
      entry,
    });
    expect(await allRows()).toEqual(before);
  });

  it("Restore an unknown entry", async () => {
    await store();
    expect(await restoreEntry(db, { id: UNKNOWN_ID, byUserId: ANA, now: NOW })).toEqual({ outcome: "not_found" });
  });
});

describe("Set category", () => {
  it("Change the category", async () => {
    const entry = await storeOne({}, { categoryId: "other", categorySource: "default" });
    const at = later(MINUTE);
    const expected: Entry = {
      ...entry,
      categoryId: "dining",
      categorySource: "manual",
      updatedAt: at.toISOString(),
      updatedBy: BEN,
    };
    expect(
      await setEntryCategory(db, { id: entry.id, byUserId: BEN, now: at, categoryId: "dining", categorySource: "manual" }),
    ).toEqual({ outcome: "changed", entry: expected });
    expect(await findEntriesBySourceMessage(db, CHAT, 10)).toEqual([expected]);
  });

  it("The same category again", async () => {
    const entry = await storeOne({}, { categoryId: "dining", categorySource: "manual" });
    const before = await allRows();
    expect(
      await setEntryCategory(db, {
        id: entry.id,
        byUserId: BEN,
        now: later(MINUTE),
        categoryId: "dining",
        categorySource: "manual",
      }),
    ).toEqual({ outcome: "unchanged", entry });
    expect(await allRows()).toEqual(before);
  });

  it("A removed entry keeps its category", async () => {
    const entry = await storeOne({}, { categoryId: "other", categorySource: "default" });
    await removeDirectly(entry.id, ANA, later(MINUTE));
    const before = await allRows();
    expect(
      await setEntryCategory(db, {
        id: entry.id,
        byUserId: BEN,
        now: later(2 * MINUTE),
        categoryId: "dining",
        categorySource: "manual",
      }),
    ).toEqual({ outcome: "unchanged", entry: removed(entry, ANA, later(MINUTE)) });
    expect(await allRows()).toEqual(before);
  });

  it("Set the category of an unknown entry", async () => {
    await store();
    expect(
      await setEntryCategory(db, {
        id: UNKNOWN_ID,
        byUserId: BEN,
        now: NOW,
        categoryId: "dining",
        categorySource: "manual",
      }),
    ).toEqual({ outcome: "not_found" });
  });
});

describe("Latest active entry of a member", () => {
  it("The latest entry of a member", async () => {
    await store();
    const { entries } = await addMessageEntries(db, message11({ now: later(5 * MINUTE) }));
    await store({ sourceMessageId: 12, payerUserId: BEN, byUserId: BEN, now: later(10 * MINUTE) });
    expect(entries[1]!.itemIndex).toBe(1);
    expect(await findLatestActiveEntry(db, ANA)).toEqual(entries[1]);
  });

  it("Removed entries are skipped", async () => {
    const first = await storeOne();
    const second = await storeOne({ sourceMessageId: 11, now: later(5 * MINUTE) });
    await removeDirectly(second.id, ANA, later(6 * MINUTE));
    expect(await findLatestActiveEntry(db, ANA)).toEqual(first);
  });

  it("A backdated entry typed last is the latest", async () => {
    await storeOne();
    const dinner = await storeOne(
      { sourceMessageId: 11, rawText: "kahapon dinner 400", now: later(5 * MINUTE) },
      { amountCentavos: 40000, description: "dinner", spentOn: "2026-09-28" },
    );
    expect(await findLatestActiveEntry(db, ANA)).toEqual(dinner);
  });

  it("An entry from another chat can be the latest", async () => {
    await storeOne({ chatId: CHAT });
    const migrated = await storeOne({ chatId: SUPERGROUP, sourceMessageId: 3, now: later(5 * MINUTE) });
    expect(await findLatestActiveEntry(db, ANA)).toEqual(migrated);
  });

  it.each([{ label: "every entry removed" }, { label: "no entries" }])(
    "No active entries: $label",
    async ({ label }) => {
      await storeOne({ sourceMessageId: 12, payerUserId: BEN, byUserId: BEN });
      if (label === "every entry removed") {
        const entry = await storeOne();
        await removeDirectly(entry.id, ANA, later(MINUTE));
      }
      expect(await findLatestActiveEntry(db, ANA)).toBeNull();
      expect(await findLatestActiveEntry(db, BEN)).not.toBeNull();
    },
  );
});

describe("Totals by category", () => {
  it("Both end dates are included", async () => {
    const dated: [string, number][] = [
      ["2026-09-27", 100],
      ["2026-09-28", 200],
      ["2026-10-04", 400],
      ["2026-10-05", 800],
    ];
    for (const [i, [spentOn, amountCentavos]] of dated.entries()) {
      await storeOne({ sourceMessageId: 10 + i }, { spentOn, amountCentavos });
    }
    expect(await totalsByCategory(db, PERIOD)).toEqual([{ categoryId: "dining", totalCentavos: 600, count: 2 }]);
  });

  it("Per-category sums and counts", async () => {
    await storeOne({ sourceMessageId: 10 }, { amountCentavos: 25000 });
    await storeOne({ sourceMessageId: 11 }, { amountCentavos: 15000 });
    await storeOne({ sourceMessageId: 12 }, { amountCentavos: 234000, categoryId: "groceries" });
    expect(await totalsByCategory(db, PERIOD)).toEqual([
      { categoryId: "groceries", totalCentavos: 234000, count: 1 },
      { categoryId: "dining", totalCentavos: 40000, count: 2 },
    ]);
  });

  it("Removed entries are left out, and restored ones count again", async () => {
    await storeOne({ sourceMessageId: 10 }, { amountCentavos: 25000 });
    const second = await storeOne({ sourceMessageId: 11 }, { amountCentavos: 15000 });
    await removeDirectly(second.id, ANA, later(MINUTE));
    expect(await totalsByCategory(db, PERIOD)).toEqual([{ categoryId: "dining", totalCentavos: 25000, count: 1 }]);
    await restoreDirectly(second.id, ANA, later(2 * MINUTE));
    expect(await totalsByCategory(db, PERIOD)).toEqual([{ categoryId: "dining", totalCentavos: 40000, count: 2 }]);
  });

  it("Selected by spent-on date", async () => {
    await storeOne({}, { spentOn: "2026-09-28" });
    expect(await totalsByCategory(db, { from: "2026-09-28", to: "2026-09-28" })).toEqual([
      { categoryId: "dining", totalCentavos: 25000, count: 1 },
    ]);
    expect(await totalsByCategory(db, { from: "2026-09-29", to: "2026-09-29" })).toEqual([]);
  });

  it("An unknown category id still counts", async () => {
    await storeOne({ sourceMessageId: 10 }, { amountCentavos: 25000 });
    await storeOne({ sourceMessageId: 11 }, { amountCentavos: 5000, categoryId: "snacks", categorySource: "manual" });
    expect(await totalsByCategory(db, PERIOD)).toEqual([
      { categoryId: "dining", totalCentavos: 25000, count: 1 },
      { categoryId: "snacks", totalCentavos: 5000, count: 1 },
    ]);
  });

  it("Entries from before a supergroup migration still count", async () => {
    await storeOne({ chatId: CHAT, sourceMessageId: 10 }, { amountCentavos: 25000 });
    await storeOne({ chatId: SUPERGROUP, sourceMessageId: 3 }, { amountCentavos: 15000 });
    expect(await totalsByCategory(db, PERIOD)).toEqual([{ categoryId: "dining", totalCentavos: 40000, count: 2 }]);
  });

  it("An empty period", async () => {
    await storeOne({}, { spentOn: "2026-09-27" });
    const removedEntry = await storeOne({ sourceMessageId: 11 }, { spentOn: "2026-09-29" });
    await removeDirectly(removedEntry.id, ANA, later(MINUTE));
    expect(await totalsByCategory(db, PERIOD)).toEqual([]);
  });

  it("A malformed period date is rejected", async () => {
    await expect(totalsByCategory(db, { from: "2026/09/28", to: "2026-10-04" })).rejects.toThrow(RangeError);
  });
});

describe("Entries in a period", () => {
  async function storeThree(): Promise<[Entry, Entry, Entry]> {
    const a = await storeOne({ sourceMessageId: 10 }, { spentOn: "2026-09-29" });
    const b = await storeOne({ sourceMessageId: 11 }, { spentOn: "2026-09-28", amountCentavos: 15000 });
    const c = await storeOne({ sourceMessageId: 12 }, { spentOn: "2026-09-28", amountCentavos: 9000 });
    await storeOne({ sourceMessageId: 13 }, { spentOn: "2026-10-05" });
    return [a, b, c];
  }

  it("Active entries only", async () => {
    const [a, b, c] = await storeThree();
    await removeDirectly(b.id, ANA, later(MINUTE));
    expect(await listEntries(db, PERIOD)).toEqual([c, a]);
  });

  it("With removed entries", async () => {
    const [a, b, c] = await storeThree();
    await removeDirectly(b.id, ANA, later(MINUTE));
    expect(await listEntries(db, PERIOD, { includeDeleted: true })).toEqual([removed(b, ANA, later(MINUTE)), c, a]);
  });

  it("A backdated entry lists by its date", async () => {
    const today = await storeOne({ sourceMessageId: 10 }, { spentOn: "2026-09-29" });
    const yesterday = await storeOne({ sourceMessageId: 11, now: later(MINUTE) }, { spentOn: "2026-09-28" });
    expect(await listEntries(db, { from: "2026-09-28", to: "2026-09-29" })).toEqual([yesterday, today]);
  });

  it("Entries from every chat are listed", async () => {
    const group = await storeOne({ chatId: CHAT, sourceMessageId: 10 });
    const supergroup = await storeOne({ chatId: SUPERGROUP, sourceMessageId: 3 });
    expect(await listEntries(db, PERIOD)).toEqual([group, supergroup]);
  });

  it("A malformed list date is rejected", async () => {
    await expect(listEntries(db, { from: "2026-09-28", to: "2026-10-4" })).rejects.toThrow(RangeError);
  });
});

describe("Count of active entries for a date", () => {
  it("Count for a date", async () => {
    await storeOne({ sourceMessageId: 10 });
    await storeOne({ sourceMessageId: 11 });
    const third = await storeOne({ sourceMessageId: 12 });
    await storeOne({ sourceMessageId: 13 }, { spentOn: "2026-09-28" });
    await removeDirectly(third.id, ANA, later(MINUTE));
    expect(await countActiveEntriesOn(db, "2026-09-29")).toBe(2);
  });

  it("Only removed entries", async () => {
    const first = await storeOne({ sourceMessageId: 10 });
    const second = await storeOne({ sourceMessageId: 11 });
    await storeOne({ sourceMessageId: 12 }, { spentOn: "2026-09-28" });
    await removeDirectly(first.id, ANA, later(MINUTE));
    await removeDirectly(second.id, ANA, later(MINUTE));
    expect(await countActiveEntriesOn(db, "2026-09-29")).toBe(0);
  });

  it("Entries from every chat are counted", async () => {
    await storeOne({ chatId: CHAT, sourceMessageId: 10 });
    await storeOne({ chatId: SUPERGROUP, sourceMessageId: 3 });
    expect(await countActiveEntriesOn(db, "2026-09-29")).toBe(2);
  });

  it("A malformed count date is rejected", async () => {
    await expect(countActiveEntriesOn(db, "29 Sep 2026")).rejects.toThrow(RangeError);
  });
});
