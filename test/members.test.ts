import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway";
import type { BotContext, FeatureModule } from "../src/gateway/registry";
import { ALLOWED_CHAT_ID, MEMBER_A, MEMBER_B } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

useCleanTables(env.DB);

const NOW = new Date("2026-09-29T10:05:30.123Z");
const EARLIER = new Date("2026-09-01T08:00:00.000Z");
const NON_MEMBER_ID = 2001;

interface MemberRow {
  user_id: number;
  display_name: string;
  username: string | null;
  first_seen_at: string;
  updated_at: string;
}

interface Seen {
  member: BotContext["gateway"]["member"];
  row: MemberRow | null;
}

let telegram: TelegramStub;
let seen: Seen[];

/** A module whose message handler records the sender it is given and the member record at that moment. */
const recorder: FeatureModule = {
  name: "recorder",
  messages: [
    async (ctx) => {
      const row = await env.DB.prepare("SELECT * FROM members WHERE user_id = ?")
        .bind(ctx.gateway.member.userId)
        .first<MemberRow>();
      seen.push({ member: { ...ctx.gateway.member }, row });
    },
  ],
};

beforeEach(async () => {
  telegram = installTelegramStub();
  vi.spyOn(console, "log").mockImplementation(() => {});
  seen = [];
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), EARLIER.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
  vi.restoreAllMocks();
});

async function send(update: unknown): Promise<Response> {
  const gateway = createGateway({ modules: [recorder], now: () => NOW });
  const ctx = createExecutionContext();
  const response = await gateway.fetch(signedRequest(update), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function expectEmpty(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe("");
}

async function memberRow(userId: number): Promise<MemberRow | null> {
  return env.DB.prepare("SELECT * FROM members WHERE user_id = ?").bind(userId).first<MemberRow>();
}

async function insertMember(userId: number, displayName: string, username: string | null): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO members (user_id, display_name, username, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(userId, displayName, username, EARLIER.toISOString(), EARLIER.toISOString())
    .run();
}

describe("Member records", () => {
  it("First update from a member", async () => {
    await expectEmpty(await send(messageUpdate({ text: "coffee 120" })), 200);
    expect(await memberRow(MEMBER_A.id)).toEqual({
      user_id: MEMBER_A.id,
      display_name: MEMBER_A.firstName,
      username: MEMBER_A.username,
      first_seen_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  it("Member changed their name", async () => {
    await insertMember(MEMBER_A.id, "Ana", "ana");
    const update = messageUpdate({ text: "coffee 120", firstName: "Anabel", username: "ana" });
    await expectEmpty(await send(update), 200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.row?.display_name).toBe("Anabel");
    expect(seen[0]?.member).toEqual({ userId: MEMBER_A.id, displayName: "Anabel" });
    const row = await memberRow(MEMBER_A.id);
    expect(row?.display_name).toBe("Anabel");
    expect(row?.first_seen_at).toBe(EARLIER.toISOString());
  });

  it("Handler reads the sender", async () => {
    await expectEmpty(await send(messageUpdate({ text: "coffee 120" })), 200);
    await expectEmpty(
      await send(messageUpdate({ text: "lunch 300", updateId: 2, userId: MEMBER_B.id, firstName: "Ben", username: "ben" })),
      200,
    );
    expect(seen.map((entry) => entry.member)).toEqual([
      { userId: MEMBER_A.id, displayName: MEMBER_A.firstName },
      { userId: MEMBER_B.id, displayName: "Ben" },
    ]);
  });

  it("Ignored update leaves no member record", async () => {
    const update = messageUpdate({ text: "coffee 120", userId: NON_MEMBER_ID, firstName: "Stranger" });
    await expectEmpty(await send(update), 200);
    expect(await memberRow(NON_MEMBER_ID)).toBeNull();
    expect(seen).toEqual([]);
  });

  it("Member record without membership", async () => {
    await insertMember(NON_MEMBER_ID, "Former", "former");
    const before = await memberRow(NON_MEMBER_ID);
    const update = messageUpdate({ text: "coffee 120", userId: NON_MEMBER_ID, firstName: "Renamed", username: "former" });
    await expectEmpty(await send(update), 200);
    expect(seen).toEqual([]);
    expect(telegram.calls).toEqual([]);
    expect(await memberRow(NON_MEMBER_ID)).toEqual(before);
    const updates = await env.DB.prepare("SELECT COUNT(*) AS n FROM updates").first<{ n: number }>();
    expect(updates?.n).toBe(0);
  });
});
