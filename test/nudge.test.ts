import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { InlineKeyboardButton } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createGateway } from "../src/gateway";
import { buildRegistry, type FeatureModule } from "../src/gateway/registry";
import { addMessageEntries, softDeleteEntry } from "../src/ledger";
import { createNudge } from "../src/nudge";
import { readNudgeSettings } from "../src/nudge/settings";
import { createScheduler, type Scheduler } from "../src/scheduler";
import { ALLOWED_CHAT_ID, MEMBER_A, MEMBER_B } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { readRun, tick } from "./helpers/scheduler";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { callbackUpdate } from "./helpers/updates";

useCleanTables(env.DB);

/** 21:00 on Wednesday 2026-09-30 in Manila. */
const T_21 = "2026-09-30T13:00:00Z";
const T_22 = "2026-09-30T14:00:00Z";
/** The id of the nudge message the bot sends. */
const NUDGE_ID = 777;
const NUDGE_TEXT = "🌙 Nothing logged for Sep 30 yet. Send an expense, or tap below if there was none.";
const NUDGE_BUTTONS: InlineKeyboardButton[][] = [[{ text: "No spending today", callback_data: "n:2026-09-30" }]];
const STALE = "This button no longer works.";

interface SendPayload {
  chat_id: number;
  text: string;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
}

interface EditPayload {
  chat_id: number;
  message_id: number;
  text: string;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
}

interface DayMarkRow {
  date: string;
  marked_by: number;
  marked_at: string;
}

let telegram: TelegramStub;
let logSpy: MockInstance<typeof console.log>;
let clock = new Date(T_21);
let nextMessageId = 1;
let nextUpdateId = 5000;

beforeEach(async () => {
  telegram = installTelegramStub();
  telegram.setResult("sendMessage", {
    message_id: NUDGE_ID,
    date: 0,
    chat: { id: ALLOWED_CHAT_ID, type: "supergroup", title: "Household" },
    text: "",
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  nextMessageId = 1;
  nextUpdateId = 5000;
  clock = new Date(T_21);
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), "2026-09-01T00:00:00.000Z")
    .run();
});

afterEach(() => {
  telegram.restore();
  logSpy.mockRestore();
});

/** The nudge with the default settings unless others are given. */
function nudge(settings = { enabled: true, hour: 21 }): FeatureModule {
  return createNudge(settings);
}

function scheduler(module: FeatureModule = nudge()): Scheduler {
  return createScheduler({ registry: buildRegistry([module]), now: () => clock });
}

/** Fires the tick at `iso`, with the scheduler's clock at the tick time. */
async function fire(target: Scheduler, iso: string): Promise<void> {
  clock = new Date(iso);
  await tick(target, iso);
}

/** A member presses a button with `data` on the nudge, at `iso`, through the gateway. */
async function press(data: string, iso: string, member = MEMBER_A, module: FeatureModule = nudge()): Promise<void> {
  clock = new Date(iso);
  const gateway = createGateway({ modules: [module], now: () => clock });
  const update = callbackUpdate({
    data,
    updateId: nextUpdateId++,
    messageId: NUDGE_ID,
    date: Math.floor(Date.parse(T_21) / 1000),
    userId: member.id,
    firstName: member.firstName,
    username: member.username,
  });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
}

/** Stores one active entry, dated `spentOn`, and returns its id. */
async function store(spentOn: string, options: { by?: number; text?: string; at?: string } = {}): Promise<number> {
  const by = options.by ?? MEMBER_A.id;
  const result = await addMessageEntries(env.DB, {
    chatId: ALLOWED_CHAT_ID,
    sourceMessageId: nextMessageId++,
    payerUserId: by,
    byUserId: by,
    rawText: options.text ?? "lunch 250",
    parser: "rules",
    now: new Date(options.at ?? "2026-09-30T04:00:00.000Z"),
    items: [
      {
        amountCentavos: 25000,
        description: "lunch",
        spentOn,
        categoryId: "dining",
        categorySource: "keyword",
        checkAmount: false,
      },
    ],
  });
  return result.entries[0]!.id;
}

function sent(): SendPayload[] {
  return telegram
    .callsTo("sendMessage")
    .filter((call) => !call.failed)
    .map((call) => call.payload as SendPayload);
}

function edits(): EditPayload[] {
  return telegram
    .callsTo("editMessageText")
    .filter((call) => !call.failed)
    .map((call) => call.payload as EditPayload);
}

function answers(): (string | undefined)[] {
  return telegram
    .callsTo("answerCallbackQuery")
    .filter((call) => !call.failed)
    .map((call) => (call.payload as { text?: string } | undefined)?.text);
}

async function marks(): Promise<DayMarkRow[]> {
  const { results } = await env.DB.prepare("SELECT date, marked_by, marked_at FROM day_marks ORDER BY date").all<DayMarkRow>();
  return results;
}

describe("The system SHALL read the nudge settings when it starts", () => {
  it("Happy path — the defaults", () => {
    const registry = buildRegistry([createNudge(readNudgeSettings({}))]);
    expect(registry.jobs.map((job) => [job.name, job.schedule])).toEqual([
      ["evening_nudge", { every: "day", hour: 21 }],
    ]);
  });

  it("Happy path — another hour", async () => {
    await fire(scheduler(nudge(readNudgeSettings({ NUDGE_HOUR: "20" }))), "2026-09-30T12:00:00Z");

    expect((await readRun(env.DB, "evening_nudge", "2026-09-30"))?.status).toBe("done");
    expect(sent().map((payload) => payload.text)).toEqual([NUDGE_TEXT]);
  });

  it("Edge case — the nudge is disabled", async () => {
    const module = nudge(readNudgeSettings({ NUDGE_ENABLED: "false" }));
    const registry = buildRegistry([module]);
    expect(registry.jobs.map((job) => job.name)).not.toContain("evening_nudge");
    expect(registry.callbacks.map((callback) => callback.prefix)).toEqual(["n"]);

    await fire(scheduler(module), T_21);

    expect(sent()).toEqual([]);
  });
});

describe("The system SHALL nudge only when nothing is logged for the day", () => {
  it("Happy path — nothing was logged", async () => {
    await fire(scheduler(), T_21);

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      chat_id: ALLOWED_CHAT_ID,
      text: NUDGE_TEXT,
      reply_markup: { inline_keyboard: NUDGE_BUTTONS },
    });
  });

  it("Happy path — something was logged", async () => {
    await store("2026-09-30");

    await fire(scheduler(), T_21);

    expect(sent()).toEqual([]);
    expect((await readRun(env.DB, "evening_nudge", "2026-09-30"))?.status).toBe("done");
  });

  it("Failure — the message cannot be sent", async () => {
    const target = scheduler();

    telegram.failNext("sendMessage");
    await fire(target, T_21);
    expect((await readRun(env.DB, "evening_nudge", "2026-09-30"))?.status).toBe("failed");

    await fire(target, T_22);
    expect((await readRun(env.DB, "evening_nudge", "2026-09-30"))?.status).toBe("done");
    expect(sent().map((payload) => payload.text)).toEqual([NUDGE_TEXT]);
  });

  it("Edge case — the day's only entries were removed", async () => {
    const id = await store("2026-09-30");
    await softDeleteEntry(env.DB, { id, byUserId: MEMBER_A.id, now: new Date("2026-09-30T05:00:00.000Z") });

    await fire(scheduler(), T_21);

    expect(sent().map((payload) => payload.text)).toEqual([NUDGE_TEXT]);
  });

  it("Edge case — an entry typed today for another day", async () => {
    await store("2026-09-29", { text: "kahapon lunch 250", at: "2026-09-30T04:00:00.000Z" });

    await fire(scheduler(), T_21);

    expect(sent().map((payload) => payload.text)).toEqual([NUDGE_TEXT]);
  });

  it("Edge case — the job runs again for the same day", async () => {
    const target = scheduler();
    await fire(target, T_21);
    expect(sent()).toHaveLength(1);

    // The scheduler runs the job again for the same date, as after a failed outcome.
    await env.DB.prepare(
      "UPDATE job_runs SET status = 'failed', last_error = 'again' WHERE job = 'evening_nudge' AND scheduled_date = '2026-09-30'",
    ).run();
    await fire(target, T_22);

    expect((await readRun(env.DB, "evening_nudge", "2026-09-30"))?.attempts).toBe(2);
    expect(sent()).toHaveLength(1);
  });

  it("Edge case — a late run names its own day", async () => {
    await fire(scheduler(), "2026-09-30T16:00:00Z");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.text).toContain("Nothing logged for Sep 30 yet");
    expect(sent()[0]?.reply_markup?.inline_keyboard).toEqual(NUDGE_BUTTONS);
  });
});

describe("The system SHALL record a no-spending day when the button is tapped", () => {
  it("Happy path — a member taps the button", async () => {
    await fire(scheduler(), T_21);
    expect(sent()).toHaveLength(1);

    await press("n:2026-09-30", "2026-09-30T13:05:00Z");

    expect(await marks()).toEqual([{ date: "2026-09-30", marked_by: MEMBER_A.id, marked_at: "2026-09-30T13:05:00.000Z" }]);
    expect(edits()).toEqual([
      expect.objectContaining({
        chat_id: ALLOWED_CHAT_ID,
        message_id: NUDGE_ID,
        text: "✅ No spending on Sep 30.",
        reply_markup: { inline_keyboard: [] },
      }),
    ]);
    expect(answers()).toEqual(["Noted."]);
    expect(sent()).toHaveLength(1);
  });

  it("Failure — data that does not hold a date", async () => {
    for (const data of ["n:", "n:today", "n:2026-02-30", "n:2026-9-30"]) {
      await press(data, "2026-09-30T13:05:00Z");
    }

    expect(await marks()).toEqual([]);
    expect(edits()).toEqual([]);
    expect(answers()).toEqual([STALE, STALE, STALE, STALE]);
  });

  it("Edge case — both members tap", async () => {
    await press("n:2026-09-30", "2026-09-30T13:05:00Z", MEMBER_A);
    await press("n:2026-09-30", "2026-09-30T13:05:10Z", MEMBER_B);

    expect(await marks()).toEqual([{ date: "2026-09-30", marked_by: MEMBER_A.id, marked_at: "2026-09-30T13:05:00.000Z" }]);
    expect(answers()).toEqual(["Noted.", "Noted."]);
  });

  it("Edge case — an expense was logged before the tap", async () => {
    await fire(scheduler(), T_21);
    await store("2026-09-30", { by: MEMBER_B.id, text: "dinner 400", at: "2026-09-30T13:02:00.000Z" });

    await press("n:2026-09-30", "2026-09-30T13:05:00Z");

    expect(await marks()).toEqual([]);
    expect(edits()).toEqual([
      expect.objectContaining({
        message_id: NUDGE_ID,
        text: "👍 Sep 30 has entries now.",
        reply_markup: { inline_keyboard: [] },
      }),
    ]);
    expect(answers()).toEqual(["Entries were logged for that day."]);
  });

  it("Edge case — the tap comes the next morning", async () => {
    await fire(scheduler(), T_21);

    await press("n:2026-09-30", "2026-09-30T23:00:00Z");

    expect((await marks()).map((row) => row.date)).toEqual(["2026-09-30"]);
    expect(edits().map((payload) => payload.text)).toEqual(["✅ No spending on Sep 30."]);
  });

  it("Edge case — a recorded day is not nudged again", async () => {
    await env.DB.prepare("INSERT INTO day_marks (date, marked_by, marked_at) VALUES ('2026-09-30', ?, ?)")
      .bind(MEMBER_A.id, "2026-09-30T10:00:00.000Z")
      .run();

    await fire(scheduler(), T_21);

    expect(sent()).toEqual([]);
    expect((await readRun(env.DB, "evening_nudge", "2026-09-30"))?.status).toBe("done");
  });
});
