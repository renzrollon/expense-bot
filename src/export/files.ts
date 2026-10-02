import { getCategory, type KeywordRow } from "../categories";
import type { Entry } from "../ledger";
import { csvAmount, csvFile, type CsvValue } from "./csv";

/** The 11 columns of an export file, in order (data-export, "export entries on /export"). */
export const EXPORT_COLUMNS: readonly string[] = [
  "id",
  "spent_on",
  "amount",
  "currency",
  "category_id",
  "category_name",
  "description",
  "payer_name",
  "created_at",
  "deleted_at",
  "raw_text",
];

/** The 13 stored columns a backup adds after the export columns, so a restore is exact (Decision 15). */
export const BACKUP_EXTRA_COLUMNS: readonly string[] = [
  "chat_id",
  "source_message_id",
  "item_index",
  "confirmation_message_id",
  "payer_user_id",
  "category_source",
  "parser",
  "check_amount",
  "created_by",
  "updated_at",
  "updated_by",
  "deleted_by",
  "source_edited_at",
];

/** The columns of a backup entries file. */
export const BACKUP_ENTRY_COLUMNS: readonly string[] = [...EXPORT_COLUMNS, ...BACKUP_EXTRA_COLUMNS];

/** The columns of a backup learned keywords file. */
export const KEYWORD_COLUMNS: readonly string[] = [
  "keyword",
  "category_id",
  "source",
  "taught_by",
  "hit_count",
  "created_at",
  "updated_at",
];

export interface EntriesCsvOptions {
  /** Display names by user id, from the member records. A payer without one is written as the user id. */
  names: ReadonlyMap<number, string>;
  /** `true` adds the backup columns. */
  full: boolean;
}

/** The entries as an export file, or as a backup entries file when `full`. Rows keep the given order. Pure. */
export function entriesCsv(entries: readonly Entry[], options: EntriesCsvOptions): string {
  const { names, full } = options;
  const rows = entries.map((entry) => (full ? [...exportRow(entry, names), ...backupExtra(entry)] : exportRow(entry, names)));
  return csvFile(full ? BACKUP_ENTRY_COLUMNS : EXPORT_COLUMNS, rows);
}

/** The learned keywords as a backup file. Rows keep the given order. Pure. */
export function keywordsCsv(rows: readonly KeywordRow[]): string {
  return csvFile(
    KEYWORD_COLUMNS,
    rows.map((row) => [row.keyword, row.categoryId, row.source, row.taughtBy, row.hitCount, row.createdAt, row.updatedAt]),
  );
}

function exportRow(entry: Entry, names: ReadonlyMap<number, string>): CsvValue[] {
  return [
    entry.id,
    entry.spentOn,
    csvAmount(entry.amountCentavos),
    entry.currency,
    entry.categoryId,
    getCategory(entry.categoryId)?.name ?? entry.categoryId,
    entry.description,
    names.get(entry.payerUserId) ?? entry.payerUserId,
    entry.createdAt,
    entry.deletedAt,
    entry.rawText,
  ];
}

function backupExtra(entry: Entry): CsvValue[] {
  return [
    entry.chatId,
    entry.sourceMessageId,
    entry.itemIndex,
    entry.confirmationMessageId,
    entry.payerUserId,
    entry.categorySource,
    entry.parser,
    entry.checkAmount ? 1 : 0,
    entry.createdBy,
    entry.updatedAt,
    entry.updatedBy,
    entry.deletedBy,
    entry.sourceEditedAt,
  ];
}
