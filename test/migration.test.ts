import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway";
import { MEMBER_A } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { probeModule, type Probe } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

useCleanTables(env.DB);

const NOW = new Date("2026-09-29T10:05:30.123Z");
const EARLIER = new Date("2026-09-01T08:00:00.000Z");
const OLD_GROUP_ID = -412345678;
const NEW_SUPERGROUP_ID = -1009876543210;
/** Telegram's sender for the notice in the new supergroup. */
const GROUP_ANONYMOUS_BOT = { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" };

let telegram: TelegramStub;
let probe: Probe;

beforeEach(async () => {
  telegram = installTelegramStub();
  vi.spyOn(console, "log").mockImplementation(() => {});
  probe = probeModule({ commands: ["tally"], messages: ["first"], editedMessages: ["first"] });
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(OLD_GROUP_ID), EARLIER.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
  vi.restoreAllMocks();
});

async function send(update: unknown): Promise<Response> {
  const gateway = createGateway({ modules: [probe.module], now: () => NOW });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function expectEmpty(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
}

async function storedChatId(): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'allowed_chat_id'").first<{ value: string }>();
  return row?.value;
}

async function settingsRows(): Promise<unknown[]> {
  return (await env.DB.prepare("SELECT * FROM settings").all()).results;
}

async function updateRows(): Promise<Record<string, unknown>[]> {
  return (await env.DB.prepare("SELECT * FROM updates ORDER BY update_id").all<Record<string, unknown>>()).results;
}

async function memberCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first<{ n: number }>();
  return row?.n ?? 0;
}

/** The notice in the old group, sent by the member who upgraded it. It names the new supergroup. */
function noticeInOldGroup(updateId = 500) {
  return {
    update_id: updateId,
    message: {
      message_id: 50,
      date: 1_780_000_000,
      chat: { id: OLD_GROUP_ID, type: "group", title: "Household" },
      from: { id: MEMBER_A.id, is_bot: false, first_name: MEMBER_A.firstName, username: MEMBER_A.username },
      migrate_to_chat_id: NEW_SUPERGROUP_ID,
    },
  };
}

/** The notice in the new supergroup, sent by GroupAnonymousBot. It names the old group. */
function noticeInNewSupergroup(updateId = 501) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      date: 1_780_000_000,
      chat: { id: NEW_SUPERGROUP_ID, type: "supergroup", title: "Household" },
      from: GROUP_ANONYMOUS_BOT,
      sender_chat: { id: NEW_SUPERGROUP_ID, type: "supergroup", title: "Household" },
      migrate_from_chat_id: OLD_GROUP_ID,
    },
  };
}

describe("Supergroup migration", () => {
  it("Notice arrives in the old group", async () => {
    await expectEmpty(await send(noticeInOldGroup()), 200);
    expect(await storedChatId()).toBe(String(NEW_SUPERGROUP_ID));
    expect(await updateRows()).toEqual([
      expect.objectContaining({
        update_id: 500,
        kind: "message",
        chat_id: OLD_GROUP_ID,
        user_id: MEMBER_A.id,
        raw: JSON.stringify(noticeInOldGroup()),
        status: "done",
        attempts: 1,
      }),
    ]);
  });

  it("Notice arrives in the new supergroup first", async () => {
    await expectEmpty(await send(noticeInNewSupergroup()), 200);
    expect(await storedChatId()).toBe(String(NEW_SUPERGROUP_ID));
    expect(await updateRows()).toEqual([
      expect.objectContaining({
        update_id: 501,
        chat_id: NEW_SUPERGROUP_ID,
        user_id: GROUP_ANONYMOUS_BOT.id,
        status: "done",
      }),
    ]);
  });

  it("Migration notice reaches no handler", async () => {
    await expectEmpty(await send(noticeInOldGroup()), 200);
    await expectEmpty(await send(noticeInNewSupergroup(502)), 200);
    expect(await storedChatId()).toBe(String(NEW_SUPERGROUP_ID));
    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
    expect(await memberCount()).toBe(0);
  });

  it("Second notice has no further effect", async () => {
    await expectEmpty(await send(noticeInOldGroup()), 200);
    const settings = await settingsRows();
    await expectEmpty(await send(noticeInNewSupergroup()), 200);
    expect(await settingsRows()).toEqual(settings);
    expect((await updateRows()).map((row) => row.update_id)).toEqual([500]);
  });

  it("Second notice has no further effect in the other order", async () => {
    await expectEmpty(await send(noticeInNewSupergroup()), 200);
    const settings = await settingsRows();
    await expectEmpty(await send(noticeInOldGroup()), 200);
    expect(await settingsRows()).toEqual(settings);
    expect((await updateRows()).map((row) => row.update_id)).toEqual([501]);
  });

  it("Applied notice is redelivered", async () => {
    await expectEmpty(await send(noticeInOldGroup()), 200);
    const settings = await settingsRows();
    const records = await updateRows();
    expect(records).toHaveLength(1);
    await expectEmpty(await send(noticeInOldGroup()), 200);
    expect(await settingsRows()).toEqual(settings);
    expect(await updateRows()).toEqual(records);
  });

  it("Updates after the migration", async () => {
    await expectEmpty(await send(noticeInOldGroup()), 200);
    await expectEmpty(await send(messageUpdate({ text: "coffee 120", updateId: 600, chatId: NEW_SUPERGROUP_ID })), 200);
    expect(probe.callsTo("message:first")).toHaveLength(1);
    expect((await updateRows()).map((row) => [row.update_id, row.chat_id])).toEqual([
      [500, OLD_GROUP_ID],
      [600, NEW_SUPERGROUP_ID],
    ]);
    await expectEmpty(await send(messageUpdate({ text: "lunch 300", updateId: 601, chatId: OLD_GROUP_ID })), 200);
    expect(probe.callsTo("message:first")).toHaveLength(1);
    expect((await updateRows()).map((row) => row.update_id)).toEqual([500, 600]);
  });

  it("Migration notice for an unrelated chat", async () => {
    const settings = await settingsRows();
    const unrelatedTo = {
      update_id: 700,
      message: { ...noticeInOldGroup().message, chat: { id: -499, type: "group", title: "Other" }, migrate_to_chat_id: -1004990 },
    };
    const unrelatedFrom = {
      update_id: 701,
      message: {
        ...noticeInNewSupergroup().message,
        chat: { id: -1004990, type: "supergroup", title: "Other" },
        migrate_from_chat_id: -499,
      },
    };
    await expectEmpty(await send(unrelatedTo), 200);
    await expectEmpty(await send(unrelatedFrom), 200);
    expect(await settingsRows()).toEqual(settings);
    expect(await updateRows()).toEqual([]);
    expect(await memberCount()).toBe(0);
    expect(probe.calls).toEqual([]);
  });
});
