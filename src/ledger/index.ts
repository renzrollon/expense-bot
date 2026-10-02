import type {
  AddResult,
  BackupWindow,
  CategoryChange,
  CategorySource,
  CategoryTotal,
  ChangeResult,
  Entry,
  EntryChange,
  LargestOptions,
  NewMessageEntries,
  ParserKind,
  Period,
} from "./types";

export type {
  AddResult,
  BackupWindow,
  CategoryChange,
  CategorySource,
  CategoryTotal,
  ChangeResult,
  Entry,
  EntryChange,
  LargestOptions,
  NewEntryItem,
  NewMessageEntries,
  ParserKind,
  Period,
} from "./types";

/** The ledger's own item limit (D10). It does not import the parser's. */
export const MAX_ENTRIES_PER_MESSAGE = 10;
/** The smallest amount, in centavos (D9). */
export const MIN_AMOUNT_CENTAVOS = 1;
/** The largest amount, in centavos (D9). */
export const MAX_AMOUNT_CENTAVOS = 999_999_999;
/** The currency every entry is written with (D23). */
export const CURRENCY = "PHP";

const CATEGORY_SOURCES: readonly CategorySource[] = ["keyword", "learned", "llm", "manual", "default"];
const PARSERS: readonly ParserKind[] = ["rules", "llm"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** The largest limit `largestEntries` accepts. */
export const MAX_LARGEST_LIMIT = 50;

/** One `expenses` row, as D1 returns it (design Decision 2). */
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
  source_edited_at: string | null;
}

/** Maps a snake_case row to the camelCase `Entry` (design Decision 3). */
function toEntry(row: ExpenseRow): Entry {
  return {
    id: row.id,
    chatId: row.chat_id,
    sourceMessageId: row.source_message_id,
    itemIndex: row.item_index,
    confirmationMessageId: row.confirmation_message_id,
    payerUserId: row.payer_user_id,
    amountCentavos: row.amount_centavos,
    currency: row.currency,
    description: row.description,
    categoryId: row.category_id,
    categorySource: row.category_source as CategorySource,
    spentOn: row.spent_on,
    rawText: row.raw_text,
    parser: row.parser as ParserKind,
    checkAmount: row.check_amount !== 0,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    sourceEditedAt: row.source_edited_at,
  };
}

function checkDate(field: string, value: string): void {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new RangeError(`${field} must be written as YYYY-MM-DD`);
  }
}

function checkPeriod(period: Period): void {
  checkDate("from", period.from);
  checkDate("to", period.to);
}

/** Design Decision 5. Throws `RangeError` naming the field, before any statement is sent. */
function validate(input: NewMessageEntries): void {
  const { items } = input;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ENTRIES_PER_MESSAGE) {
    throw new RangeError(`items must hold 1 to ${MAX_ENTRIES_PER_MESSAGE} entries`);
  }
  if (!PARSERS.includes(input.parser)) {
    throw new RangeError("parser must be one of: " + PARSERS.join(", "));
  }
  for (const item of items) {
    const amount = item.amountCentavos;
    if (!Number.isSafeInteger(amount) || amount < MIN_AMOUNT_CENTAVOS || amount > MAX_AMOUNT_CENTAVOS) {
      throw new RangeError(
        `amountCentavos must be a whole number from ${MIN_AMOUNT_CENTAVOS} to ${MAX_AMOUNT_CENTAVOS}`,
      );
    }
    checkDate("spentOn", item.spentOn);
    if (typeof item.categoryId !== "string" || item.categoryId === "") {
      throw new RangeError("categoryId must not be empty");
    }
    if (!CATEGORY_SOURCES.includes(item.categorySource)) {
      throw new RangeError("categorySource must be one of: " + CATEGORY_SOURCES.join(", "));
    }
  }
}

const SELECT_MESSAGE = "SELECT * FROM expenses WHERE chat_id = ? AND source_message_id = ? ORDER BY item_index";

/** Stores every item of one message, all or nothing, once (design Decision 4). */
export async function addMessageEntries(db: D1Database, input: NewMessageEntries): Promise<AddResult> {
  validate(input);

  const stored = await findEntriesBySourceMessage(db, input.chatId, input.sourceMessageId);
  if (stored.length > 0) return { created: false, entries: stored };

  const nowText = input.now.toISOString();
  const inserts = input.items.map((item, index) =>
    db
      .prepare(
        `INSERT INTO expenses (
           chat_id, source_message_id, item_index, payer_user_id, amount_centavos, currency,
           description, category_id, category_source, spent_on, raw_text, parser, check_amount,
           created_at, created_by, updated_at, updated_by
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?14, ?15)`,
      )
      .bind(
        input.chatId,
        input.sourceMessageId,
        index,
        input.payerUserId,
        item.amountCentavos,
        CURRENCY,
        item.description,
        item.categoryId,
        item.categorySource,
        item.spentOn,
        input.rawText,
        input.parser,
        item.checkAmount ? 1 : 0,
        nowText,
        input.byUserId,
      ),
  );
  const results = await db.batch<ExpenseRow>([
    ...inserts,
    db.prepare(SELECT_MESSAGE).bind(input.chatId, input.sourceMessageId),
  ]);
  const rows = results.at(-1)?.results ?? [];
  return { created: true, entries: rows.map(toEntry) };
}

/** Fills the confirmation id of every entry of the message that has none (D13). Returns the rows filled. */
export async function attachConfirmation(
  db: D1Database,
  chatId: number,
  sourceMessageId: number,
  confirmationMessageId: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE expenses SET confirmation_message_id = ?
       WHERE chat_id = ? AND source_message_id = ? AND confirmation_message_id IS NULL`,
    )
    .bind(confirmationMessageId, chatId, sourceMessageId)
    .run();
  return result.meta.changes;
}

/** Every entry of one message, removed ones included, in item order. */
export async function findEntriesBySourceMessage(
  db: D1Database,
  chatId: number,
  sourceMessageId: number,
): Promise<Entry[]> {
  const { results } = await db.prepare(SELECT_MESSAGE).bind(chatId, sourceMessageId).all<ExpenseRow>();
  return results.map(toEntry);
}

/**
 * Runs one guarded `UPDATE ... RETURNING *`. When no row comes back, a `SELECT`
 * of the id tells `unchanged` apart from `not_found` (design Decision 3, D14).
 */
async function guardedChange(db: D1Database, id: number, update: D1PreparedStatement): Promise<ChangeResult> {
  const changed = await update.first<ExpenseRow>();
  if (changed) return { outcome: "changed", entry: toEntry(changed) };
  const row = await db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<ExpenseRow>();
  return row ? { outcome: "unchanged", entry: toEntry(row) } : { outcome: "not_found" };
}

/** Removes an active entry, recording the removal as the last change too (D44). */
export async function softDeleteEntry(db: D1Database, change: EntryChange): Promise<ChangeResult> {
  const nowText = change.now.toISOString();
  return guardedChange(
    db,
    change.id,
    db
      .prepare(
        `UPDATE expenses SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1, updated_by = ?2
         WHERE id = ?3 AND deleted_at IS NULL
         RETURNING *`,
      )
      .bind(nowText, change.byUserId, change.id),
  );
}

/** Brings a removed entry back, every other field as it was (D15). */
export async function restoreEntry(db: D1Database, change: EntryChange): Promise<ChangeResult> {
  return guardedChange(
    db,
    change.id,
    db
      .prepare(
        `UPDATE expenses SET deleted_at = NULL, deleted_by = NULL, updated_at = ?1, updated_by = ?2
         WHERE id = ?3 AND deleted_at IS NOT NULL
         RETURNING *`,
      )
      .bind(change.now.toISOString(), change.byUserId, change.id),
  );
}

/** Sets the category of an active entry, when it differs from the stored one. */
export async function setEntryCategory(db: D1Database, change: CategoryChange): Promise<ChangeResult> {
  return guardedChange(
    db,
    change.id,
    db
      .prepare(
        `UPDATE expenses SET category_id = ?1, category_source = ?2, updated_at = ?3, updated_by = ?4
         WHERE id = ?5 AND deleted_at IS NULL AND (category_id <> ?1 OR category_source <> ?2)
         RETURNING *`,
      )
      .bind(change.categoryId, change.categorySource, change.now.toISOString(), change.byUserId, change.id),
  );
}

/** The member's active entry created last, from the whole ledger (D17). */
export async function findLatestActiveEntry(db: D1Database, payerUserId: number): Promise<Entry | null> {
  const row = await db
    .prepare(
      `SELECT * FROM expenses WHERE payer_user_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(payerUserId)
    .first<ExpenseRow>();
  return row ? toEntry(row) : null;
}

/** Sums and counts of active entries by category, both end dates included (D19). */
export async function totalsByCategory(db: D1Database, period: Period): Promise<CategoryTotal[]> {
  checkPeriod(period);
  const { results } = await db
    .prepare(
      `SELECT category_id, SUM(amount_centavos) AS total_centavos, COUNT(*) AS count
       FROM expenses
       WHERE deleted_at IS NULL AND spent_on BETWEEN ? AND ?
       GROUP BY category_id
       ORDER BY total_centavos DESC, category_id`,
    )
    .bind(period.from, period.to)
    .all<{ category_id: string; total_centavos: number; count: number }>();
  return results.map((row) => ({ categoryId: row.category_id, totalCentavos: row.total_centavos, count: row.count }));
}

/** Entries in the period by spent-on date then id, active only unless asked (D20). */
export async function listEntries(
  db: D1Database,
  period: Period,
  options: { includeDeleted?: boolean } = {},
): Promise<Entry[]> {
  checkPeriod(period);
  const activeOnly = options.includeDeleted === true ? "" : " AND deleted_at IS NULL";
  const { results } = await db
    .prepare(`SELECT * FROM expenses WHERE spent_on BETWEEN ? AND ?${activeOnly} ORDER BY spent_on, id`)
    .bind(period.from, period.to)
    .all<ExpenseRow>();
  return results.map(toEntry);
}

/** The number of active entries dated `spentOn`, from the whole ledger (D18). */
export async function countActiveEntriesOn(db: D1Database, spentOn: string): Promise<number> {
  checkDate("spentOn", spentOn);
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM expenses WHERE deleted_at IS NULL AND spent_on = ?")
    .bind(spentOn)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** The entry with this id, active or removed. A value that is not a positive whole number gives null, with no statement. */
export async function getEntry(db: D1Database, id: number): Promise<Entry | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const row = await db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<ExpenseRow>();
  return row ? toEntry(row) : null;
}

/**
 * Sets the edit time on every entry of the message that has none, removed ones
 * included, and returns the message's entries in item order (Decision 4).
 * The time and author of the last change are left as they were.
 */
export async function markSourceEdited(
  db: D1Database,
  chatId: number,
  sourceMessageId: number,
  now: Date,
): Promise<Entry[]> {
  const results = await db.batch<ExpenseRow>([
    db
      .prepare(
        `UPDATE expenses SET source_edited_at = ?1
         WHERE chat_id = ?2 AND source_message_id = ?3 AND source_edited_at IS NULL`,
      )
      .bind(now.toISOString(), chatId, sourceMessageId),
    db.prepare(SELECT_MESSAGE).bind(chatId, sourceMessageId),
  ]);
  return (results.at(-1)?.results ?? []).map(toEntry);
}

/** The active entries of the period with the largest amounts, at most `limit` (Decision 4). */
export async function largestEntries(db: D1Database, period: Period, options: LargestOptions): Promise<Entry[]> {
  checkPeriod(period);
  const { limit } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LARGEST_LIMIT) {
    throw new RangeError(`limit must be a whole number from 1 to ${MAX_LARGEST_LIMIT}`);
  }
  const excluded = [...(options.excludeCategoryIds ?? [])];
  const notIn = excluded.length > 0 ? ` AND category_id NOT IN (${excluded.map(() => "?").join(", ")})` : "";
  const { results } = await db
    .prepare(
      `SELECT * FROM expenses
       WHERE deleted_at IS NULL AND spent_on BETWEEN ? AND ?${notIn}
       ORDER BY amount_centavos DESC, spent_on, id LIMIT ?`,
    )
    .bind(period.from, period.to, ...excluded, limit)
    .all<ExpenseRow>();
  return results.map(toEntry);
}

/** The number of distinct spent-on dates in the period with at least one active entry. */
export async function countDaysWithEntries(db: D1Database, period: Period): Promise<number> {
  checkPeriod(period);
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT spent_on) AS count FROM expenses
       WHERE deleted_at IS NULL AND spent_on BETWEEN ? AND ?`,
    )
    .bind(period.from, period.to)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Every entry, removed ones included, dated on or after `datedFrom` or last
 * changed at or after `changedSince`, in id order (Decision 4, Decision 16).
 */
export async function listBackupEntries(db: D1Database, window: BackupWindow): Promise<Entry[]> {
  checkDate("datedFrom", window.datedFrom);
  if (typeof window.changedSince !== "string" || window.changedSince === "") {
    throw new RangeError("changedSince must be an ISO-8601 time");
  }
  const { results } = await db
    .prepare("SELECT * FROM expenses WHERE spent_on >= ?1 OR updated_at >= ?2 ORDER BY id")
    .bind(window.datedFrom, window.changedSince)
    .all<ExpenseRow>();
  return results.map(toEntry);
}

/** The removed entry whose remover is `byUserId` and whose removal time is exactly `at`, highest id first (Decision 8). */
export async function findRemovalAt(db: D1Database, byUserId: number, at: Date): Promise<Entry | null> {
  const row = await db
    .prepare(
      `SELECT * FROM expenses WHERE deleted_by = ?1 AND deleted_at = ?2
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(byUserId, at.toISOString())
    .first<ExpenseRow>();
  return row ? toEntry(row) : null;
}
