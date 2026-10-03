import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { teachKeyword } from "../src/categories";
import { NIGHTLY_BACKUP } from "../src/config/schedule";
import { exporter } from "../src/export";
import { buildRegistry } from "../src/gateway/registry";
import { createScheduler, type Scheduler } from "../src/scheduler";
import { useCleanTables } from "./helpers/db";
import { insertRun, logEntries, readRun, tick } from "./helpers/scheduler";
import { installTelegramStub, type MultipartPayload, type TelegramStub } from "./helpers/telegram";

/** The group: the allowed chat id of the data-export spec. */
const GROUP = -1001;
/** 23:00 on Wednesday 2026-09-30 in Manila. */
const T_23 = "2026-09-30T15:00:00Z";
/** An hour later, still due. */
const T_00 = "2026-09-30T16:00:00Z";

const EXPORT_HEADER =
  "id,spent_on,amount,currency,category_id,category_name,description,payer_name,created_at,deleted_at,raw_text";
const BACKUP_HEADER =
  `${EXPORT_HEADER},chat_id,source_message_id,item_index,confirmation_message_id,payer_user_id,` +
  "category_source,parser,check_amount,created_by,updated_at,updated_by,deleted_by,source_edited_at";
const KEYWORD_HEADER = "keyword,category_id,source,taught_by,hit_count,created_at,updated_at";
const ENTRY_7_BACKUP =
  "7,2026-09-29,250.00,PHP,dining,Dining & Delivery,lunch,Ana,2026-09-29T02:00:03.000Z,,lunch 250," +
  "'-1001,41,0,900,1001,keyword,rules,0,1001,2026-09-29T02:00:03.000Z,1001,,";
const NOT_A_CHAT_ID = "BACKUP_CHAT_ID is not a chat id";

/** One stored row of `expenses`. Fields left out default to entry 7 of the data-export spec. */
interface Row {
  id: number;
  sourceMessageId: number;
  spentOn: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: number | null;
}

interface SentDocument {
  chatId: string;
  fileName: string;
  caption: string;
  disableNotification: string | undefined;
  text: string;
}

useCleanTables(env.DB);

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
let clock = new Date(T_23);
let nextMessageId = 3000;

beforeEach(async () => {
  telegram = installTelegramStub();
  telegram.setResult("sendDocument", {
    message_id: nextMessageId++,
    date: Math.floor(Date.parse(T_23) / 1000),
    chat: { id: GROUP, type: "supergroup" },
    document: { file_id: "f", file_unique_id: "u" },
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)").bind(
      String(GROUP),
      "2026-09-01T00:00:00.000Z",
    ),
    env.DB.prepare(
      `INSERT INTO members (user_id, display_name, username, first_seen_at, updated_at)
       VALUES (1001, 'Ana', 'ana', ?1, ?1), (1002, 'Ben', 'ben', ?1, ?1)`,
    ).bind("2026-09-01T00:00:00.000Z"),
  ]);
});

afterEach(() => {
  telegram.restore();
  logSpy.mockRestore();
});

function build(): Scheduler {
  return createScheduler({ registry: buildRegistry([exporter]), now: () => clock });
}

/** Fires the tick at `iso`, with the scheduler's clock at the same time. */
async function fire(iso: string, testEnv: Env = envWith({}), scheduler: Scheduler = build()): Promise<void> {
  clock = new Date(iso);
  await tick(scheduler, iso, testEnv);
}

/**
 * A changed copy of the test environment. `BACKUP_CHAT_ID` is absent unless given,
 * whatever `wrangler.jsonc` sets, so the household's own value never changes a test.
 */
function envWith(overrides: Record<string, unknown>): Env {
  const { BACKUP_CHAT_ID: _live, ...rest } = { ...env } as Record<string, unknown>;
  return { ...rest, ...overrides } as unknown as Env;
}

/** Writes one row of `expenses`, as entry 7 unless told otherwise. */
async function insertEntry(row: Partial<Row> & { id: number }): Promise<void> {
  const full: Row = {
    sourceMessageId: 41,
    spentOn: "2026-09-29",
    createdAt: "2026-09-29T02:00:03.000Z",
    updatedAt: row.createdAt ?? "2026-09-29T02:00:03.000Z",
    deletedAt: null,
    deletedBy: null,
    ...row,
  };
  await env.DB.prepare(
    `INSERT INTO expenses (id, chat_id, source_message_id, item_index, confirmation_message_id, payer_user_id,
       amount_centavos, currency, description, category_id, category_source, spent_on, raw_text, parser,
       check_amount, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
     VALUES (?, ?, ?, 0, 900, 1001, 25000, 'PHP', 'lunch', 'dining', 'keyword', ?, 'lunch 250', 'rules',
       0, ?, 1001, ?, 1001, ?, ?)`,
  )
    .bind(full.id, GROUP, full.sourceMessageId, full.spentOn, full.createdAt, full.updatedAt, full.deletedAt, full.deletedBy)
    .run();
}

/** Every accepted `sendDocument`, in order. */
function documents(): SentDocument[] {
  return telegram
    .callsTo("sendDocument")
    .filter((call) => !call.failed)
    .map((call) => {
      const payload = call.payload as MultipartPayload;
      expect(payload.files).toHaveLength(1);
      const file = payload.files[0]!;
      expect(payload.fields.document).toBe(`attach://${file.field}`);
      return {
        chatId: payload.fields.chat_id ?? "",
        fileName: file.fileName,
        caption: payload.fields.caption ?? "",
        disableNotification: payload.fields.disable_notification,
        text: file.text,
      };
    });
}

/** A file's rows after its header, each without its CRLF. */
function rows(text: string, header: string): string[] {
  expect(text.endsWith("\r\n")).toBe(true);
  const lines = text.slice(0, -2).split("\r\n");
  expect(lines[0]).toBe(header);
  return lines.slice(1);
}

describe("send a nightly backup at 23:00", () => {
  it("Happy path — a night's backup", async () => {
    await insertEntry({ id: 7 });
    await teachKeyword(env.DB, {
      keyword: "acai",
      categoryId: "dining",
      taughtBy: 1001,
      now: new Date("2026-09-29T02:12:00.000Z"),
    });
    await fire(T_23);

    expect(exporter.jobs).toEqual([expect.objectContaining({ name: "nightly_backup", schedule: NIGHTLY_BACKUP })]);
    expect(NIGHTLY_BACKUP).toEqual({ every: "day", hour: 23 });
    const sent = documents();
    expect(sent).toHaveLength(2);
    const [entries, keywords] = sent;
    expect(entries).toMatchObject({
      chatId: String(GROUP),
      fileName: "backup-entries-2026-09-30.csv",
      caption: "🗄 Backup · Sep 30 · 1 entry",
      disableNotification: "true",
    });
    expect(entries!.text).toBe(`${BACKUP_HEADER}\r\n${ENTRY_7_BACKUP}\r\n`);
    expect(keywords).toMatchObject({
      chatId: String(GROUP),
      fileName: "backup-keywords-2026-09-30.csv",
      caption: "🗄 Learned keywords · Sep 30 · 1 keyword",
      disableNotification: "true",
    });
    expect(keywords!.text).toBe(
      `${KEYWORD_HEADER}\r\nacai,dining,learned,1001,0,2026-09-29T02:12:00.000Z,2026-09-29T02:12:00.000Z\r\n`,
    );
    expect((await readRun(env.DB, "nightly_backup", "2026-09-30"))?.status).toBe("done");
  });

  it("Failure — the second file cannot be sent", async () => {
    await insertEntry({ id: 7 });
    // Fail the second sendDocument of the first tick: the keywords file.
    const stubbed = globalThis.fetch;
    let documentCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/sendDocument") && ++documentCalls === 2) telegram.failNext("sendDocument");
      return stubbed(input, init);
    }) as typeof fetch;

    await fire(T_23);
    const afterFirst = await readRun(env.DB, "nightly_backup", "2026-09-30");
    expect(afterFirst?.status).toBe("failed");
    expect(telegram.callsTo("sendDocument").filter((call) => call.failed)).toHaveLength(1);

    await fire(T_00);
    expect((await readRun(env.DB, "nightly_backup", "2026-09-30"))?.status).toBe("done");
    expect(documents().map((document) => document.fileName)).toEqual([
      "backup-entries-2026-09-30.csv",
      "backup-keywords-2026-09-30.csv",
    ]);
  });

  it("Edge case — removed entries and older changed entries", async () => {
    await insertEntry({ id: 1, sourceMessageId: 1, spentOn: "2026-08-01", createdAt: "2026-08-01T03:00:00.000Z" });
    await insertEntry({
      id: 2,
      sourceMessageId: 2,
      spentOn: "2026-09-10",
      createdAt: "2026-09-10T03:00:00.000Z",
      updatedAt: "2026-09-11T03:00:00.000Z",
      deletedAt: "2026-09-11T03:00:00.000Z",
      deletedBy: 1001,
    });
    await insertEntry({
      id: 3,
      sourceMessageId: 3,
      spentOn: "2026-06-10",
      createdAt: "2026-06-10T03:00:00.000Z",
      updatedAt: "2026-09-20T03:00:00.000Z",
    });
    await insertEntry({ id: 4, sourceMessageId: 4, spentOn: "2026-07-31", createdAt: "2026-07-31T03:00:00.000Z" });
    await fire(T_23);

    const [entries] = documents();
    expect(entries?.caption).toBe("🗄 Backup · Sep 30 · 3 entries");
    const lines = rows(entries!.text, BACKUP_HEADER);
    expect(lines.map((line) => Number(line.split(",")[0]))).toEqual([1, 2, 3]);
    const deletedAt = EXPORT_HEADER.split(",").indexOf("deleted_at");
    expect(lines[1]!.split(",")[deletedAt]).toBe("2026-09-11T03:00:00.000Z");
  });

  it("Edge case — nothing to back up", async () => {
    await fire(T_23);
    const sent = documents();
    expect(sent.map((document) => [document.fileName, document.caption, document.text])).toEqual([
      ["backup-entries-2026-09-30.csv", "🗄 Backup · Sep 30 · 0 entries", `${BACKUP_HEADER}\r\n`],
      ["backup-keywords-2026-09-30.csv", "🗄 Learned keywords · Sep 30 · 0 keywords", `${KEYWORD_HEADER}\r\n`],
    ]);
  });

  it("Edge case — the window in January", async () => {
    await insertEntry({ id: 1, sourceMessageId: 1, spentOn: "2026-11-30", createdAt: "2026-11-30T03:00:00.000Z" });
    await insertEntry({ id: 2, sourceMessageId: 2, spentOn: "2026-12-01", createdAt: "2026-12-01T03:00:00.000Z" });
    await insertEntry({ id: 3, sourceMessageId: 3, spentOn: "2027-01-15", createdAt: "2027-01-15T03:00:00.000Z" });
    // 23:00 on 2027-01-15 in Manila.
    await fire("2027-01-15T15:00:00Z");
    const [entries] = documents();
    expect(entries?.fileName).toBe("backup-entries-2027-01-15.csv");
    expect(entries?.caption).toBe("🗄 Backup · Jan 15 · 2 entries");
    expect(rows(entries!.text, BACKUP_HEADER).map((line) => Number(line.split(",")[0]))).toEqual([2, 3]);
  });
});

describe("send the whole ledger each month, a part a night", () => {
  /** 23:00 in Manila on the given day of October 2026. */
  const night = (day: number) => `2026-10-${String(day).padStart(2, "0")}T15:00:00Z`;

  function snapshots(): SentDocument[] {
    return documents().filter((document) => document.fileName.startsWith("backup-snapshot-"));
  }

  it("Happy path — part 1 on the 1st", async () => {
    // Entry 1 is dated and stored long before the entries file's window; entry 2 is removed.
    await insertEntry({ id: 1, sourceMessageId: 1, spentOn: "2025-01-05", createdAt: "2025-01-05T03:00:00.000Z" });
    await insertEntry({ id: 2, sourceMessageId: 2, deletedAt: "2026-09-29T05:00:00.000Z", deletedBy: 1001 });
    await insertEntry({ id: 3, sourceMessageId: 3 });

    await fire(night(1));

    expect(documents().map((document) => document.fileName)).toEqual([
      "backup-entries-2026-10-01.csv",
      "backup-keywords-2026-10-01.csv",
      "backup-snapshot-part-1-2026-10-01.csv",
    ]);
    const [snapshot] = snapshots();
    expect(snapshot?.caption).toBe("🗄 Snapshot part 1 of 1 · ids 1–3 · Oct 1 · 3 entries");
    expect(snapshot?.chatId).toBe(String(GROUP));
    expect(snapshot?.disableNotification).toBe("true");
    // The same header as the entries file, so the restore script reads it as one.
    expect(rows(snapshot!.text, BACKUP_HEADER).map((line) => Number(line.split(",")[0]))).toEqual([1, 2, 3]);
  });

  it("Happy path — part 2 on the 2nd", async () => {
    await insertEntry({ id: 1, sourceMessageId: 1 });
    await insertEntry({ id: 1001, sourceMessageId: 1001 });
    await insertEntry({ id: 1500, sourceMessageId: 1500 });

    await fire(night(2));

    const [snapshot] = snapshots();
    expect(snapshot?.fileName).toBe("backup-snapshot-part-2-2026-10-02.csv");
    expect(snapshot?.caption).toBe("🗄 Snapshot part 2 of 2 · ids 1001–1500 · Oct 2 · 2 entries");
    expect(rows(snapshot!.text, BACKUP_HEADER).map((line) => Number(line.split(",")[0]))).toEqual([1001, 1500]);
  });

  it("Edge case — the ledger ends before the part", async () => {
    await insertEntry({ id: 3 });

    await fire(night(2));

    expect(documents()).toHaveLength(2);
    expect(snapshots()).toEqual([]);
  });

  it("Edge case — after night 28", async () => {
    await insertEntry({ id: 28500, sourceMessageId: 28500 });

    await fire(night(29));

    expect(documents().map((document) => document.fileName)).toEqual([
      "backup-entries-2026-10-29.csv",
      "backup-keywords-2026-10-29.csv",
    ]);
  });

  it("Failure — a repeated run sends only what is left", async () => {
    await insertEntry({ id: 3 });
    await env.DB.prepare(
      `INSERT INTO job_sends (job, scheduled_date, part, chat_id, message_id, sent_at) VALUES
         ('nightly_backup', '2026-10-01', 'entries', ?1, 1, '2026-10-01T15:00:01.000Z'),
         ('nightly_backup', '2026-10-01', 'keywords', ?1, 2, '2026-10-01T15:00:02.000Z')`,
    )
      .bind(GROUP)
      .run();

    await fire(night(1));

    expect(documents().map((document) => document.fileName)).toEqual(["backup-snapshot-part-1-2026-10-01.csv"]);
    expect(await readRun(env.DB, "nightly_backup", "2026-10-01")).toMatchObject({ status: "done" });
  });
});

describe("send backups to the configured chat", () => {
  it("Happy path — no setting", async () => {
    expect((envWith({}) as unknown as Record<string, unknown>).BACKUP_CHAT_ID).toBeUndefined();
    await fire(T_23);
    expect(documents().map((document) => document.chatId)).toEqual([String(GROUP), String(GROUP)]);
  });

  it("Happy path — a private chat", async () => {
    await fire(T_23, envWith({ BACKUP_CHAT_ID: 1001 }));
    expect(documents().map((document) => document.chatId)).toEqual(["1001", "1001"]);
    expect(telegram.callsTo("sendMessage")).toHaveLength(0);
  });

  it.each(["ana", "12.5", ""])("Failure — a value that is not a chat id: %j", async (value) => {
    await fire(T_23, envWith({ BACKUP_CHAT_ID: value }));
    expect(telegram.calls).toHaveLength(0);
    const run = await readRun(env.DB, "nightly_backup", "2026-09-30");
    expect(run?.status).toBe("failed");
    expect(run?.lastError).toBe(NOT_A_CHAT_ID);
  });

  it("Edge case — a supergroup id given as text", async () => {
    await fire(T_23, envWith({ BACKUP_CHAT_ID: "-1001234567890" }));
    expect(documents().map((document) => document.chatId)).toEqual(["-1001234567890", "-1001234567890"]);
  });
});

describe("tell the group when a backup did not finish", () => {
  /** 03:00 on 2026-10-01 in Manila: the first tick after the backup's 3-hour window. */
  const T_03 = "2026-09-30T19:00:00Z";
  const T_04 = "2026-09-30T20:00:00Z";
  const FAILED_RUN = { job: "nightly_backup", scheduledDate: "2026-09-30", scheduledHour: 23 } as const;

  interface AlertPayload {
    chat_id: number;
    text: string;
    disable_notification?: boolean;
  }

  beforeEach(() => {
    telegram.setResult("sendMessage", {
      message_id: 4000,
      date: Math.floor(Date.parse(T_03) / 1000),
      chat: { id: GROUP, type: "supergroup" },
      text: "",
    });
  });

  function alerts(): AlertPayload[] {
    return telegram
      .callsTo("sendMessage")
      .filter((call) => !call.failed)
      .map((call) => call.payload as AlertPayload);
  }

  function events(name: string): Record<string, unknown>[] {
    return logEntries(logSpy).filter((entry) => entry["event"] === name);
  }

  it("Happy path — a backup that finished", async () => {
    await fire(T_23);
    await fire(T_03);
    expect(alerts()).toEqual([]);
  });

  it("Failure — every attempt in the window fails", async () => {
    const broken = envWith({ BACKUP_CHAT_ID: "ana" });
    for (const iso of [T_23, T_00, "2026-09-30T17:00:00Z", "2026-09-30T18:00:00Z"]) await fire(iso, broken);
    expect(await readRun(env.DB, "nightly_backup", "2026-09-30")).toMatchObject({ status: "failed", attempts: 4 });
    expect(alerts()).toEqual([]);

    await fire(T_03, broken);
    await fire(T_04, broken);

    expect(exporter.jobs).toEqual([expect.objectContaining({ name: "nightly_backup", alertOnFailure: true })]);
    expect(alerts()).toEqual([
      expect.objectContaining({
        chat_id: GROUP,
        text:
          "⚠️ Job nightly_backup did not finish · Sep 30 23:00 · failed, 4 attempts\n" +
          "It is not tried again for that date. /ping shows each job's last run.",
        disable_notification: true,
      }),
    ]);
    expect(events("job_alert_sent")).toEqual([
      { event: "job_alert_sent", job: "nightly_backup", scheduled_date: "2026-09-30" },
    ]);
    expect(await readRun(env.DB, "nightly_backup", "2026-09-30")).toMatchObject({ status: "failed", attempts: 4 });
    expect(documents()).toEqual([]);
  });

  it("Failure — the alert cannot be sent", async () => {
    await insertRun(env.DB, { ...FAILED_RUN, status: "failed", attempts: 4, lastError: "boom" });
    telegram.failNext("sendMessage");

    await fire(T_03);
    expect(alerts()).toEqual([]);
    expect(events("job_alert_failed")).toEqual([
      { event: "job_alert_failed", job: "nightly_backup", scheduled_date: "2026-09-30" },
    ]);

    await fire(T_04);
    expect(alerts()).toHaveLength(1);
  });

  it("Edge case — an attempt that was cut off", async () => {
    await insertRun(env.DB, {
      ...FAILED_RUN,
      status: "running",
      attempts: 2,
      createdAt: "2026-09-30T15:00:00.000Z",
      startedAt: "2026-09-30T16:00:00.000Z",
    });

    await fire(T_03);

    expect(alerts().map((alert) => alert.text.split("\n")[0])).toEqual([
      "⚠️ Job nightly_backup did not finish · Sep 30 23:00 · interrupted, 2 attempts",
    ]);
  });

  it("Edge case — the first skip of a new database", async () => {
    // As on the first deploy: no earlier run record of the backup exists.
    await fire(T_03);
    await fire(T_04);
    expect((await readRun(env.DB, "nightly_backup", "2026-09-30"))?.status).toBe("skipped");
    expect(alerts()).toEqual([]);
  });

  it("Failure — a backup that ran before is skipped", async () => {
    await insertRun(env.DB, { ...FAILED_RUN, scheduledDate: "2026-09-29", status: "done" });

    await fire(T_03);
    expect((await readRun(env.DB, "nightly_backup", "2026-09-30"))?.status).toBe("skipped");
    await fire(T_04);
    await fire("2026-09-30T21:00:00Z");

    expect(alerts()).toEqual([
      expect.objectContaining({
        chat_id: GROUP,
        text:
          "⚠️ Job nightly_backup did not run · Sep 30 23:00 · skipped\n" +
          "No tick came in its catch-up window, so it is not tried again for that date. /ping shows each job's last run.",
        disable_notification: true,
      }),
    ]);
    expect(events("job_alert_sent")).toEqual([
      { event: "job_alert_sent", job: "nightly_backup", scheduled_date: "2026-09-30" },
    ]);
    expect(await readRun(env.DB, "nightly_backup", "2026-09-30")).toMatchObject({ status: "skipped", attempts: 0 });
  });
});
