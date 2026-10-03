import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { digests } from "../src/digests";
import { buildRegistry } from "../src/gateway/registry";
import { addMessageEntries } from "../src/ledger";
import { createScheduler, type Scheduler } from "../src/scheduler";
import { MEMBER_A } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { readRun, tick } from "./helpers/scheduler";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";

useCleanTables(env.DB);

/** The allowed chat id of the `scheduled-digests` preamble. */
const CHAT_ID = -1001;
/** 19:00 on Sunday 2026-10-04 in Manila. */
const SUNDAY_19 = "2026-10-04T11:00:00Z";
/** 08:00 on Thursday 2026-10-01 in Manila. */
const FIRST_08 = "2026-10-01T00:00:00Z";

interface SendPayload {
  chat_id: number;
  text: string;
  link_preview_options?: unknown;
}

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
let clock = new Date(SUNDAY_19);
let nextMessageId = 1;

beforeEach(async () => {
  telegram = installTelegramStub();
  telegram.setResult("sendMessage", {
    message_id: 700,
    date: 0,
    chat: { id: CHAT_ID, type: "supergroup", title: "Household" },
    text: "",
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  nextMessageId = 1;
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(CHAT_ID), "2026-09-01T00:00:00.000Z")
    .run();
});

afterEach(() => {
  telegram.restore();
  logSpy.mockRestore();
});

function build(): Scheduler {
  return createScheduler({ registry: buildRegistry([digests]), now: () => clock });
}

/** Fires the tick at `iso`, with the scheduler's clock at the tick time unless `at` is given. */
async function fire(scheduler: Scheduler, iso: string, options: { testEnv?: Env; at?: string } = {}): Promise<void> {
  clock = new Date(options.at ?? iso);
  await tick(scheduler, iso, options.testEnv);
}

function envWith(overrides: Record<string, unknown>): Env {
  return { ...env, ...overrides } as unknown as Env;
}

/** Stores one active entry of `pesos` in `categoryId`, dated `spentOn`. */
async function store(pesos: number, categoryId: string, spentOn: string, description = "item"): Promise<void> {
  await addMessageEntries(env.DB, {
    chatId: CHAT_ID,
    sourceMessageId: nextMessageId++,
    payerUserId: MEMBER_A.id,
    byUserId: MEMBER_A.id,
    rawText: `${description} ${pesos}`,
    parser: "rules",
    now: new Date(`${spentOn}T12:00:00.000Z`),
    items: [
      {
        amountCentavos: pesos * 100,
        description,
        spentOn,
        categoryId,
        categorySource: "keyword",
        checkAmount: false,
      },
    ],
  });
}

/** Accepted `sendMessage` calls. */
function sent(): SendPayload[] {
  return telegram
    .callsTo("sendMessage")
    .filter((call) => !call.failed)
    .map((call) => call.payload as SendPayload);
}

function lines(text: string): string[] {
  return text.split("\n");
}

describe("The system SHALL send a weekly digest on Sunday at 19:00", () => {
  it("Happy path — the digest of a week", async () => {
    // ₱3,200 groceries, ₱2,150 dining, ₱1,300 transport, ₱1,100 bills, ₱700 other: 23 entries,
    // of which ₱3,100 is dated from 2026-10-01 to 2026-10-04; and ₱2,000 in transfer.
    const week: [number, string, string][] = [
      [1000, "groceries", "2026-09-28"],
      [1000, "groceries", "2026-09-29"],
      [600, "groceries", "2026-09-30"],
      [300, "groceries", "2026-10-02"],
      [300, "groceries", "2026-10-04"],
      [250, "dining", "2026-09-28"],
      [250, "dining", "2026-09-28"],
      [250, "dining", "2026-09-29"],
      [250, "dining", "2026-09-30"],
      [250, "dining", "2026-10-01"],
      [250, "dining", "2026-10-02"],
      [250, "dining", "2026-10-03"],
      [400, "dining", "2026-10-04"],
      [260, "transport", "2026-09-28"],
      [260, "transport", "2026-09-29"],
      [260, "transport", "2026-09-30"],
      [260, "transport", "2026-10-01"],
      [260, "transport", "2026-10-03"],
      [700, "bills", "2026-09-29"],
      [400, "bills", "2026-10-01"],
      [200, "other", "2026-09-28"],
      [70, "other", "2026-09-30"],
      [430, "other", "2026-10-04"],
      [2000, "transfer", "2026-10-02"],
    ];
    for (const [pesos, categoryId, spentOn] of week) await store(pesos, categoryId, spentOn);

    await fire(build(), SUNDAY_19);

    expect(sent()).toEqual([
      {
        chat_id: CHAT_ID,
        text: [
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
        link_preview_options: { is_disabled: true },
      },
    ]);
  });

  it("Failure — the message cannot be sent", async () => {
    await store(250, "dining", "2026-10-03");
    const scheduler = build();

    telegram.failNext("sendMessage");
    await fire(scheduler, SUNDAY_19);
    expect((await readRun(env.DB, "weekly_digest", "2026-10-04"))?.status).toBe("failed");

    await fire(scheduler, "2026-10-04T12:00:00Z");
    expect((await readRun(env.DB, "weekly_digest", "2026-10-04"))?.status).toBe("done");
    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.text).toContain("Weekly digest · Sep 28 to Oct 4");
  });

  it("Edge case — a week without entries", async () => {
    await fire(build(), SUNDAY_19);

    expect(sent().map((payload) => payload.text)).toEqual([
      "🌱 Nothing logged for Sep 28 to Oct 4. A fresh week starts tomorrow.",
    ]);
  });

  it("Edge case — a late run covers its own week", async () => {
    await store(999, "health", "2026-09-27");
    await store(100, "dining", "2026-10-04");

    await fire(build(), "2026-10-04T13:00:00Z");

    expect(sent()).toHaveLength(1);
    const text = sent()[0]!.text;
    expect(lines(text)[0]).toBe("📊 Weekly digest · Sep 28 to Oct 4");
    expect(lines(text)[1]).toBe("₱100 · 1 entry");
    expect(text).not.toContain("Health");
    expect(text).not.toContain("₱999");
  });

  it("Happy path — a digest a day late", async () => {
    await store(100, "dining", "2026-10-04");

    // Monday 19:00, exactly 24 hours after the slot.
    await fire(build(), "2026-10-05T11:00:00Z");

    expect(sent().map((payload) => lines(payload.text)[0])).toEqual(["📊 Weekly digest · Sep 28 to Oct 4"]);
  });

  it("Failure — a digest more than a day late", async () => {
    await store(100, "dining", "2026-10-04");

    await fire(build(), "2026-10-05T12:00:00Z");

    expect(sent()).toEqual([]);
    expect((await readRun(env.DB, "weekly_digest", "2026-10-04"))?.status).toBe("skipped");
  });

  it("Edge case — the month to date starts on the 1st", async () => {
    await store(5000, "groceries", "2026-09-30");
    await store(300, "dining", "2026-10-02");

    await fire(build(), SUNDAY_19);

    expect(sent()).toHaveLength(1);
    const digest = lines(sent()[0]!.text);
    expect(digest[1]).toBe("₱5,300 · 2 entries");
    expect(digest.at(-1)).toBe("Month to date: ₱300");
  });
});

describe("The system SHALL send a monthly recap on the 1st at 08:00", () => {
  it("Happy path — the recap of a month", async () => {
    await store(12000, "housing", "2026-09-01", "rent");
    await store(5000, "transfer", "2026-09-15", "cash in");
    await store(3200, "bills", "2026-09-27", "meralco");
    await store(2340, "groceries", "2026-09-29", "groceries gcash");
    await store(250, "dining", "2026-09-29", "lunch");
    await store(180, "transport", "2026-09-29", "grab");
    await store(150, "other", "2026-09-29", "acai");

    await fire(build(), FIRST_08);

    expect(sent()).toEqual([
      {
        chat_id: CHAT_ID,
        text: [
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
        link_preview_options: { is_disabled: true },
      },
    ]);
  });

  it("Failure — the ledger cannot be read", async () => {
    await store(250, "dining", "2026-09-29", "lunch");
    const scheduler = build();
    const db = failingDb(env.DB);
    db.failWhen((sql) => /\bFROM expenses\b/.test(sql));

    await fire(scheduler, FIRST_08, { testEnv: envWith({ DB: db.db }) });
    expect(sent()).toHaveLength(0);
    expect((await readRun(env.DB, "monthly_recap", "2026-10-01"))?.status).toBe("failed");

    await fire(scheduler, "2026-10-01T01:00:00Z");
    expect(sent()).toHaveLength(1);
    expect(lines(sent()[0]!.text)[0]).toBe("📊 September 2026");
  });

  it("Edge case — a month without entries", async () => {
    await store(400, "dining", "2026-10-01");

    await fire(build(), FIRST_08);

    expect(sent().map((payload) => payload.text)).toEqual(["🌱 Nothing logged in September 2026."]);
  });

  it("Edge case — the recap of December", async () => {
    await store(310, "dining", "2026-12-24", "noche buena");

    await fire(build(), "2027-01-01T00:00:00Z");

    expect(sent()).toHaveLength(1);
    const recap = lines(sent()[0]!.text);
    expect(recap[0]).toBe("📊 December 2026");
    const top = recap.indexOf("Top entries");
    expect(top).toBeGreaterThan(0);
    expect(recap[top + 1]).toBe("1. ₱310 · 🍽 Dining · noche buena · Dec 24");
    expect(recap[top + 2]).toBe("");
    expect(recap.slice(-2)).toEqual(["Daily average: ₱10", "Days with entries: 1 of 31"]);
  });

  it("Edge case — a half peso is rounded up, and February is short", async () => {
    await store(14, "dining", "2027-02-10");

    await fire(build(), "2027-03-01T00:00:00Z");

    // The same tick catches up the weekly digest of Sunday Feb 28, 13 hours late.
    const recaps = sent().filter((payload) => payload.text.startsWith("📊 February 2027"));
    expect(recaps).toHaveLength(1);
    expect(lines(recaps[0]!.text).slice(-2)).toEqual(["Daily average: ₱1", "Days with entries: 1 of 28"]);
  });

  it("Happy path — a recap two days late", async () => {
    await store(250, "dining", "2026-09-29", "lunch");

    // Oct 3 at 08:00, exactly 48 hours after the slot.
    await fire(build(), "2026-10-03T00:00:00Z");

    expect(sent().map((payload) => lines(payload.text)[0])).toEqual(["📊 September 2026"]);
  });

  it("Failure — a recap more than two days late", async () => {
    await store(250, "dining", "2026-09-29", "lunch");

    await fire(build(), "2026-10-03T01:00:00Z");

    expect(sent()).toEqual([]);
    expect((await readRun(env.DB, "monthly_recap", "2026-10-01"))?.status).toBe("skipped");
  });

  it("Edge case — only entries that are not counted", async () => {
    await store(5000, "transfer", "2026-09-15", "cash in");

    await fire(build(), FIRST_08);

    expect(sent()).toHaveLength(1);
    const recap = lines(sent()[0]!.text);
    expect(recap).not.toContain("Top entries");
    expect(recap.slice(-2)).toEqual(["Daily average: ₱0", "Days with entries: 1 of 30"]);
  });
});

describe("The system SHALL send each digest once per period", () => {
  it("Happy path — the job runs again for the same Sunday", async () => {
    await store(250, "dining", "2026-10-03");
    const scheduler = build();
    await fire(scheduler, SUNDAY_19);
    expect(sent()).toHaveLength(1);

    // The scheduler runs the job again for the same date, as after a failed outcome.
    await env.DB.prepare(
      "UPDATE job_runs SET status = 'failed', last_error = 'again' WHERE job = 'weekly_digest' AND scheduled_date = '2026-10-04'",
    ).run();
    await fire(scheduler, "2026-10-04T12:00:00Z");

    expect((await readRun(env.DB, "weekly_digest", "2026-10-04"))?.attempts).toBe(2);
    expect(sent()).toHaveLength(1);
  });

  it("Failure — the run's outcome was not saved", async () => {
    await store(250, "dining", "2026-09-29", "lunch");
    const scheduler = build();
    const db = failingDb(env.DB);
    db.failWhen((sql) => sql.startsWith("UPDATE job_runs SET status = 'done'"));

    await fire(scheduler, FIRST_08, { testEnv: envWith({ DB: db.db }) });
    expect(sent()).toHaveLength(1);
    expect((await readRun(env.DB, "monthly_recap", "2026-10-01"))?.status).toBe("running");

    // The lease has run out, so a later tick runs the job again for the same date.
    await fire(scheduler, "2026-10-01T01:00:00Z");

    expect(sent()).toHaveLength(1);
    const run = await readRun(env.DB, "monthly_recap", "2026-10-01");
    expect(run?.attempts).toBe(2);
    expect(run?.status).toBe("done");
  });

  it("Edge case — the next period is sent", async () => {
    await store(250, "dining", "2026-10-03");
    const scheduler = build();
    await fire(scheduler, SUNDAY_19);
    expect(sent()).toHaveLength(1);

    await store(180, "transport", "2026-10-07");
    await fire(scheduler, "2026-10-11T11:00:00Z");

    expect(sent()).toHaveLength(2);
    expect(lines(sent()[1]!.text)[0]).toBe("📊 Weekly digest · Oct 5 to Oct 11");
  });
});
