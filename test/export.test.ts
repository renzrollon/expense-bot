import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { core } from "../src/core";
import { exporter } from "../src/export";
import { createGateway } from "../src/gateway";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type MultipartPayload, type TelegramCall, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

/** 10:00 on Tuesday 2026-09-29 in Manila. */
const TUESDAY = new Date("2026-09-29T02:00:00.000Z");
const COMMAND_MESSAGE_ID = 60;

const EXPORT_HEADER =
  "id,spent_on,amount,currency,category_id,category_name,description,payer_name,created_at,deleted_at,raw_text";
const ENTRY_7_ROW = "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250";
const USAGE = "Usage: /export, /export 2026-08 or /export all";

/** One stored row of `expenses`. Fields left out default to entry 7 of the data-export spec. */
interface Row {
  id: number;
  chatId: number;
  sourceMessageId: number;
  itemIndex: number;
  confirmationMessageId: number | null;
  payerUserId: number;
  amountCentavos: number;
  description: string;
  categoryId: string;
  categorySource: string;
  spentOn: string;
  rawText: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: number | null;
}

useCleanTables(env.DB);

let telegram: TelegramStub;
let nextUpdateId: number;

beforeEach(async () => {
  telegram = installTelegramStub();
  telegram.setResult("sendDocument", {
    message_id: 950,
    date: Math.floor(TUESDAY.getTime() / 1000),
    chat: { id: ALLOWED_CHAT_ID, type: "supergroup" },
    document: { file_id: "f", file_unique_id: "u" },
  });
  nextUpdateId = 700;
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), TUESDAY.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
});

/** Writes one row of `expenses`, as entry 7 unless told otherwise. */
async function insertEntry(row: Partial<Row> & { id: number }): Promise<void> {
  const full: Row = {
    chatId: ALLOWED_CHAT_ID,
    sourceMessageId: 41,
    itemIndex: 0,
    confirmationMessageId: 900,
    payerUserId: MEMBER_A.id,
    amountCentavos: 25000,
    description: "lunch",
    categoryId: "dining",
    categorySource: "keyword",
    spentOn: "2026-09-29",
    rawText: "lunch 250",
    createdAt: "2026-09-29T02:00:03.000Z",
    updatedAt: "2026-09-29T02:00:03.000Z",
    deletedAt: null,
    deletedBy: null,
    ...row,
  };
  await env.DB.prepare(
    `INSERT INTO expenses (id, chat_id, source_message_id, item_index, confirmation_message_id, payer_user_id,
       amount_centavos, currency, description, category_id, category_source, spent_on, raw_text, parser,
       check_amount, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PHP', ?, ?, ?, ?, ?, 'rules', 0, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      full.id,
      full.chatId,
      full.sourceMessageId,
      full.itemIndex,
      full.confirmationMessageId,
      full.payerUserId,
      full.amountCentavos,
      full.description,
      full.categoryId,
      full.categorySource,
      full.spentOn,
      full.rawText,
      full.createdAt,
      full.payerUserId,
      full.updatedAt,
      full.payerUserId,
      full.deletedAt,
      full.deletedBy,
    )
    .run();
}

/** Entries dated on the given dates, with ids from 1 and a source message each. */
async function insertDated(...dates: string[]): Promise<void> {
  for (const [i, spentOn] of dates.entries()) {
    await insertEntry({ id: i + 1, sourceMessageId: i + 1, spentOn, description: `item ${i + 1}` });
  }
}

/** Ana sends the command at 10:00 on 2026-09-29; the attempt must succeed. */
async function send(text: string): Promise<void> {
  const update: Update = messageUpdate({
    text,
    updateId: nextUpdateId++,
    messageId: COMMAND_MESSAGE_ID,
    date: Math.floor(TUESDAY.getTime() / 1000),
  });
  const gateway = createGateway({ modules: [core, exporter], now: () => TUESDAY });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
}

function accepted(method: string): TelegramCall[] {
  return telegram.callsTo(method).filter((call) => !call.failed);
}

interface SentDocument {
  fileName: string;
  caption: string;
  text: string;
  fields: Record<string, string>;
}

/** The one document sent, as a reply to the command, with no other message. */
function onlyDocument(): SentDocument {
  expect(accepted("sendMessage")).toHaveLength(0);
  const calls = accepted("sendDocument");
  expect(calls).toHaveLength(1);
  const payload = calls[0]!.payload as MultipartPayload;
  expect(payload.files).toHaveLength(1);
  const file = payload.files[0]!;
  expect(payload.fields.chat_id).toBe(String(ALLOWED_CHAT_ID));
  expect(payload.fields.document).toBe(`attach://${file.field}`);
  expect(JSON.parse(payload.fields.reply_parameters ?? "{}")).toEqual({
    message_id: COMMAND_MESSAGE_ID,
    allow_sending_without_reply: true,
  });
  return { fileName: file.fileName, caption: payload.fields.caption ?? "", text: file.text, fields: payload.fields };
}

/** The one text reply to the command, with no document. */
function onlyReply(): string {
  expect(accepted("sendDocument")).toHaveLength(0);
  const calls = accepted("sendMessage");
  expect(calls).toHaveLength(1);
  const payload = calls[0]!.payload as { chat_id: unknown; text: string; reply_parameters?: unknown };
  expect(payload.chat_id).toBe(ALLOWED_CHAT_ID);
  expect(payload.reply_parameters).toEqual({ message_id: COMMAND_MESSAGE_ID, allow_sending_without_reply: true });
  return payload.text;
}

/** A file's rows after the header, each without its CRLF. */
function rows(text: string): string[] {
  expect(text.endsWith("\r\n")).toBe(true);
  const lines = text.slice(0, -2).split("\r\n");
  expect(lines[0]).toBe(EXPORT_HEADER);
  return lines.slice(1);
}

/** The id cell of each row. */
function ids(text: string): number[] {
  return rows(text).map((row) => Number(row.split(",")[0]));
}

/** Active entries with ids from 1 to `count`, one statement, all dated `spentOn`. */
async function insertMany(count: number, spentOn = "2026-09-15"): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?1)
     INSERT INTO expenses (id, chat_id, source_message_id, item_index, payer_user_id, amount_centavos, currency,
       description, category_id, category_source, spent_on, raw_text, parser, check_amount,
       created_at, created_by, updated_at, updated_by)
     SELECT n, ?2, n, 0, ?3, 25000, 'PHP', 'lunch', 'dining', 'keyword', ?4, 'lunch 250', 'rules', 0, ?5, ?3, ?5, ?3
     FROM numbers`,
  )
    .bind(count, ALLOWED_CHAT_ID, MEMBER_A.id, spentOn, "2026-09-15T02:00:03.000Z")
    .run();
}

describe("export entries on /export", () => {
  it("Happy path — the current month", async () => {
    await insertEntry({ id: 7 });
    await send("/export");
    expect(exporter.name).toBe("export");
    expect(exporter.commands).toEqual([
      expect.objectContaining({ name: "export", description: "CSV file: /export, /export 2026-08, /export all" }),
    ]);
    const document = onlyDocument();
    expect(document.fileName).toBe("expenses-2026-09.csv");
    expect(document.caption).toBe("📄 September 2026 · 1 entry");
    expect(document.text).toBe(`${EXPORT_HEADER}\r\n${ENTRY_7_ROW}\r\n`);
  });

  it("Happy path — another month", async () => {
    await insertDated("2026-07-31", "2026-08-01", "2026-08-31", "2026-09-01");
    await send("/export 2026-08");
    const document = onlyDocument();
    expect(document.fileName).toBe("expenses-2026-08.csv");
    expect(document.caption).toBe("📄 August 2026 · 2 entries");
    expect(rows(document.text).map((row) => row.split(",")[1])).toEqual(["2026-08-01", "2026-08-31"]);
    expect(ids(document.text)).toEqual([2, 3]);
  });

  it.each(["/export august", "/export 2026-13", "/export 2026-8", "/export 2026-08 extra"])(
    "Failure — text that is not a month: %s",
    async (text) => {
      await insertDated("2026-08-15");
      await send(text);
      expect(onlyReply()).toBe(USAGE);
    },
  );

  it("Failure — nothing to export", async () => {
    await insertDated("2026-07-31", "2026-09-01");
    await send("/export 2026-08");
    expect(onlyReply()).toBe("No entries for August 2026.");
  });

  it("Failure — nothing to export, for all", async () => {
    await insertEntry({ id: 7, deletedAt: "2026-09-29T02:05:00.000Z", deletedBy: MEMBER_A.id });
    await send("/export all");
    expect(onlyReply()).toBe("No entries yet.");
  });

  it("Edge case — everything", async () => {
    // Ids out of date order, so the file's order is by date, not by id.
    await insertEntry({ id: 1, sourceMessageId: 1, spentOn: "2026-09-29" });
    await insertEntry({ id: 2, sourceMessageId: 2, spentOn: "2025-12-30" });
    await insertEntry({ id: 3, sourceMessageId: 3, spentOn: "2026-08-15" });
    await send("/export all");
    const document = onlyDocument();
    expect(document.fileName).toBe("expenses-all.csv");
    expect(document.caption).toBe("📄 All months · 3 entries");
    expect(ids(document.text)).toEqual([2, 3, 1]);
  });

  it("Edge case — removed entries are left out", async () => {
    await insertEntry({ id: 7 });
    await insertEntry({
      id: 8,
      sourceMessageId: 42,
      spentOn: "2026-09-10",
      deletedAt: "2026-09-10T04:00:00.000Z",
      deletedBy: MEMBER_A.id,
    });
    await send("/export");
    const document = onlyDocument();
    expect(document.caption).toBe("📄 September 2026 · 1 entry");
    expect(rows(document.text)).toEqual([ENTRY_7_ROW]);
  });

  it("Edge case — casing and spacing of the text", async () => {
    await insertDated("2025-12-30", "2026-09-29");
    await send("/export all");
    const expected = onlyDocument();
    for (const text of ["/export   ALL  ", "/export All"]) {
      telegram.calls.length = 0;
      await send(text);
      const document = onlyDocument();
      expect(document.fileName).toBe(expected.fileName);
      expect(document.caption).toBe(expected.caption);
      expect(document.text).toBe(expected.text);
    }
  });

  it("Failure — more entries than one file holds, for all", async () => {
    await insertMany(1501);
    await send("/export all");
    expect(onlyReply()).toBe(
      "📄 1501 entries are more than one file holds (1500). Export one month at a time, such as /export 2026-09.",
    );
  });

  it("Edge case — as many entries as one file holds, for all", async () => {
    await insertMany(1501);
    await env.DB.prepare("UPDATE expenses SET deleted_at = ?, deleted_by = ? WHERE id = 1501")
      .bind("2026-09-16T02:00:00.000Z", MEMBER_A.id)
      .run();
    await send("/export all");
    const document = onlyDocument();
    expect(document.caption).toBe("📄 All months · 1500 entries");
    expect(rows(document.text)).toHaveLength(1500);
  });

  it("Edge case — a month has no limit", async () => {
    await insertMany(1501);
    await send("/export 2026-09");
    expect(onlyDocument().caption).toBe("📄 September 2026 · 1501 entries");
  });

  it("Edge case — a name or a category that is not known", async () => {
    await insertEntry({ id: 7, payerUserId: 1003, categoryId: "snacks", categorySource: "manual" });
    await send("/export");
    const [row] = rows(onlyDocument().text);
    const cells = row!.split(",");
    expect(cells[EXPORT_HEADER.split(",").indexOf("payer_name")]).toBe("1003");
    expect(cells[EXPORT_HEADER.split(",").indexOf("category_name")]).toBe("snacks");
  });
});
