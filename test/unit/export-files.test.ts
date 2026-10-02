import { describe, expect, it } from "vitest";
import type { KeywordRow } from "../../src/categories";
import {
  BACKUP_ENTRY_COLUMNS,
  EXPORT_COLUMNS,
  KEYWORD_COLUMNS,
  entriesCsv,
  keywordsCsv,
} from "../../src/export/files";
import type { Entry } from "../../src/ledger";

const EXPORT_HEADER =
  "id,spent_on,amount,currency,category_id,category_name,description,payer_name,created_at,deleted_at,raw_text";
const BACKUP_HEADER =
  `${EXPORT_HEADER},chat_id,source_message_id,item_index,confirmation_message_id,payer_user_id,` +
  "category_source,parser,check_amount,created_by,updated_at,updated_by,deleted_by,source_edited_at";
const KEYWORD_HEADER = "keyword,category_id,source,taught_by,hit_count,created_at,updated_at";

const ENTRY_7_EXPORT = "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250";
const ENTRY_7_BACKUP = `${ENTRY_7_EXPORT},'-1001,41,0,900,1001,keyword,rules,0,1001,2026-09-29T02:00:03.000Z,1001,,`;

const NAMES = new Map([
  [1001, "Ana"],
  [1002, "Ben"],
]);

/** Entry 7 of the data-export spec. */
const ENTRY_7: Entry = {
  id: 7,
  chatId: -1001,
  sourceMessageId: 41,
  itemIndex: 0,
  confirmationMessageId: 900,
  payerUserId: 1001,
  amountCentavos: 25000,
  currency: "PHP",
  description: "lunch",
  categoryId: "dining",
  categorySource: "keyword",
  spentOn: "2026-09-29",
  rawText: "lunch 250",
  parser: "rules",
  checkAmount: false,
  createdAt: "2026-09-29T02:00:03.000Z",
  createdBy: 1001,
  updatedAt: "2026-09-29T02:00:03.000Z",
  updatedBy: 1001,
  deletedAt: null,
  deletedBy: null,
  sourceEditedAt: null,
};

function file(header: string, ...rows: string[]): string {
  return [header, ...rows].map((line) => `${line}\r\n`).join("");
}

describe("the header rows of the three files", () => {
  it("the export file", () => {
    expect(EXPORT_COLUMNS.join(",")).toBe(EXPORT_HEADER);
    expect(entriesCsv([], { names: NAMES, full: false })).toBe(file(EXPORT_HEADER));
  });

  it("the backup entries file", () => {
    expect(BACKUP_ENTRY_COLUMNS.join(",")).toBe(BACKUP_HEADER);
    expect(entriesCsv([], { names: NAMES, full: true })).toBe(file(BACKUP_HEADER));
  });

  it("the learned keywords file", () => {
    expect(KEYWORD_COLUMNS.join(",")).toBe(KEYWORD_HEADER);
    expect(keywordsCsv([])).toBe(file(KEYWORD_HEADER));
  });
});

describe("The system SHALL export entries on /export", () => {
  it("Happy path — the current month: the row of entry 7", () => {
    expect(entriesCsv([ENTRY_7], { names: NAMES, full: false })).toBe(file(EXPORT_HEADER, ENTRY_7_EXPORT));
  });

  it("Edge case — a name or a category that is not known", () => {
    const entry: Entry = { ...ENTRY_7, id: 8, payerUserId: 1003, categoryId: "snacks", amountCentavos: 150050 };
    expect(entriesCsv([entry], { names: NAMES, full: false })).toBe(
      file(EXPORT_HEADER, "8,2026-09-29,1500.50,PHP,snacks,snacks,lunch,1003,2026-09-29T02:00:03.000Z,,lunch 250"),
    );
  });

  it("entries are written in the order given", () => {
    const later: Entry = { ...ENTRY_7, id: 9, spentOn: "2026-09-30", payerUserId: 1002 };
    expect(entriesCsv([ENTRY_7, later], { names: NAMES, full: false })).toBe(
      file(EXPORT_HEADER, ENTRY_7_EXPORT, "9,2026-09-30,250.00,PHP,dining,Dining & Delivery,lunch,Ben,2026-09-29T02:00:03.000Z,,lunch 250"),
    );
  });
});

describe("The system SHALL send a nightly backup at 23:00", () => {
  it("Happy path — a night's backup: the row of entry 7", () => {
    expect(entriesCsv([ENTRY_7], { names: NAMES, full: true })).toBe(file(BACKUP_HEADER, ENTRY_7_BACKUP));
  });

  it("Edge case — removed entries: a removed entry in the backup form", () => {
    const removed: Entry = {
      ...ENTRY_7,
      id: 12,
      sourceMessageId: 45,
      confirmationMessageId: null,
      description: "",
      rawText: "=1+1\nsecond line",
      checkAmount: true,
      updatedAt: "2026-09-29T03:00:00.000Z",
      updatedBy: 1002,
      deletedAt: "2026-09-29T03:00:00.000Z",
      deletedBy: 1002,
      sourceEditedAt: "2026-09-29T02:30:00.000Z",
    };
    expect(entriesCsv([removed], { names: NAMES, full: true })).toBe(
      file(
        BACKUP_HEADER,
        "12,2026-09-29,250.00,PHP,dining,Dining & Delivery,,Ana,2026-09-29T02:00:03.000Z,2026-09-29T03:00:00.000Z," +
          `"'=1+1\nsecond line",'-1001,45,0,,1001,keyword,rules,1,1001,2026-09-29T03:00:00.000Z,1002,1002,2026-09-29T02:30:00.000Z`,
      ),
    );
  });

  it("the learned keywords file holds each row as stored", () => {
    const rows: KeywordRow[] = [
      {
        keyword: "acai",
        categoryId: "dining",
        source: "learned",
        taughtBy: 1001,
        hitCount: 3,
        createdAt: "2026-09-29T02:05:00.000Z",
        updatedAt: "2026-09-29T02:06:00.000Z",
      },
      {
        keyword: "milk tea",
        categoryId: "dining",
        source: "llm",
        taughtBy: null,
        hitCount: 0,
        createdAt: "2026-09-29T02:07:00.000Z",
        updatedAt: "2026-09-29T02:07:00.000Z",
      },
    ];
    expect(keywordsCsv(rows)).toBe(
      file(
        KEYWORD_HEADER,
        "acai,dining,learned,1001,3,2026-09-29T02:05:00.000Z,2026-09-29T02:06:00.000Z",
        "milk tea,dining,llm,,0,2026-09-29T02:07:00.000Z,2026-09-29T02:07:00.000Z",
      ),
    );
  });
});
