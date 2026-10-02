import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { useCleanTables } from "./helpers/db";

const db = env.DB;
const NOW = "2026-09-30T14:00:00.000Z";
const CHECK_FAILED = /CHECK constraint failed/;
const DAY_MARKS_PK_FAILED = /UNIQUE constraint failed: day_marks\.date/;
const JOB_SENDS_PK_FAILED = /UNIQUE constraint failed: job_sends\.job, job_sends\.scheduled_date, job_sends\.part/;

useCleanTables(db);

interface DayMarkRow {
  date: string;
  marked_by: number;
  marked_at: string;
}

interface JobSendRow {
  job: string;
  scheduled_date: string;
  part: string;
  chat_id: number;
  message_id: number;
  sent_at: string;
}

const DAY_MARK: DayMarkRow = { date: "2026-09-30", marked_by: 111, marked_at: NOW };

const JOB_SEND: JobSendRow = {
  job: "digest",
  scheduled_date: "2026-09-30",
  part: "text",
  chat_id: -1001234567890,
  message_id: 42,
  sent_at: NOW,
};

async function insert(table: string, row: object): Promise<void> {
  const columns = Object.keys(row);
  await db
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .bind(...Object.values(row))
    .run();
}

describe("day_marks", () => {
  it("accepts a well-formed row", async () => {
    await insert("day_marks", DAY_MARK);
    const row = await db.prepare("SELECT * FROM day_marks").first<DayMarkRow>();
    expect(row).toEqual(DAY_MARK);
  });

  it("rejects a date that is not YYYY-MM-DD", async () => {
    await expect(insert("day_marks", { ...DAY_MARK, date: "2026-9-30" })).rejects.toThrow(CHECK_FAILED);
  });

  it("rejects a second mark for the same date", async () => {
    await insert("day_marks", DAY_MARK);
    await expect(insert("day_marks", { ...DAY_MARK, marked_by: 222 })).rejects.toThrow(DAY_MARKS_PK_FAILED);
  });
});

describe("job_sends", () => {
  it("accepts a well-formed row", async () => {
    await insert("job_sends", JOB_SEND);
    const row = await db.prepare("SELECT * FROM job_sends").first<JobSendRow>();
    expect(row).toEqual(JOB_SEND);
  });

  it.each<[string, Partial<JobSendRow>]>([
    ["an empty job name", { job: "" }],
    ["a job name of 33 characters", { job: "a".repeat(33) }],
    ["a scheduled date that is not YYYY-MM-DD", { scheduled_date: "2026-9-30" }],
    ["an empty part", { part: "" }],
    ["a part of 33 characters", { part: "p".repeat(33) }],
  ])("rejects %s", async (_label, fields) => {
    await expect(insert("job_sends", { ...JOB_SEND, ...fields })).rejects.toThrow(CHECK_FAILED);
  });

  it("rejects a second send for the same job, date and part", async () => {
    await insert("job_sends", JOB_SEND);
    await expect(insert("job_sends", { ...JOB_SEND, message_id: 43 })).rejects.toThrow(JOB_SENDS_PK_FAILED);
  });
});

describe("expenses additions", () => {
  it("adds source_edited_at, NULL on a new row", async () => {
    await insert("expenses", {
      chat_id: -1001234567890,
      source_message_id: 10,
      item_index: 0,
      payer_user_id: 111,
      amount_centavos: 25000,
      currency: "PHP",
      description: "lunch",
      category_id: "dining",
      category_source: "keyword",
      spent_on: "2026-09-30",
      raw_text: "lunch 250",
      parser: "rules",
      check_amount: 0,
      created_at: NOW,
      created_by: 111,
      updated_at: NOW,
      updated_by: 111,
    });
    const columns = (await db.prepare("PRAGMA table_info(expenses)").all<{ name: string }>()).results;
    expect(columns.map((column) => column.name)).toContain("source_edited_at");
    const row = await db.prepare("SELECT source_edited_at FROM expenses").first<{ source_edited_at: string | null }>();
    expect(row).toEqual({ source_edited_at: null });
  });

  it("adds the indexes expenses_updated_at and expenses_removed", async () => {
    const indexes = (
      await db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'expenses' ORDER BY name")
        .all<{ name: string }>()
    ).results.map((index) => index.name);
    expect(indexes).toEqual(expect.arrayContaining(["expenses_updated_at", "expenses_removed"]));
  });
});
