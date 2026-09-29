import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getMember, refreshMember } from "../src/gateway/members";
import { getAllowedChatId, setAllowedChatId } from "../src/gateway/settings";
import {
  claimUpdate,
  failUpdate,
  finishUpdate,
  getLastReceivedAt,
  getParked,
  type ClaimInput,
} from "../src/gateway/update-log";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./helpers/constants";
import { useCleanTables } from "./helpers/db";

useCleanTables(env.DB);

const db = env.DB;
const NOW = new Date("2026-09-29T10:05:30.123Z");
const RAW = '{"update_id":77,"message":{"text":"coffee  120"}}';

function ago(ms: number, from: Date = NOW): Date {
  return new Date(from.getTime() - ms);
}

function later(ms: number, from: Date = NOW): Date {
  return new Date(from.getTime() + ms);
}

function claimInput(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    updateId: 77,
    kind: "message",
    chatId: ALLOWED_CHAT_ID,
    userId: MEMBER_A.id,
    raw: RAW,
    now: NOW,
    ...overrides,
  };
}

interface UpdateRow {
  update_id: number;
  kind: string;
  chat_id: number;
  user_id: number | null;
  raw: string;
  status: string;
  attempts: number;
  last_error: string | null;
  received_at: string;
  claimed_at: string;
  finished_at: string | null;
}

interface SeedRow {
  updateId?: number;
  status: "processing" | "done" | "failed" | "parked";
  attempts: number;
  claimedAt?: Date;
  receivedAt?: Date;
  lastError?: string | null;
}

async function seed(row: SeedRow): Promise<void> {
  const receivedAt = (row.receivedAt ?? ago(3_600_000)).toISOString();
  await db
    .prepare(
      `INSERT INTO updates (update_id, kind, chat_id, user_id, raw, status, attempts, last_error, received_at, claimed_at)
       VALUES (?, 'message', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.updateId ?? 77,
      ALLOWED_CHAT_ID,
      MEMBER_A.id,
      RAW,
      row.status,
      row.attempts,
      row.lastError ?? null,
      receivedAt,
      (row.claimedAt ?? ago(60_000)).toISOString(),
    )
    .run();
}

async function readRow(updateId = 77): Promise<UpdateRow | null> {
  return db.prepare("SELECT * FROM updates WHERE update_id = ?").bind(updateId).first<UpdateRow>();
}

describe("claimUpdate", () => {
  it("claims a new update and records it", async () => {
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "claimed", attempt: 1 });
    expect(await readRow()).toEqual({
      update_id: 77,
      kind: "message",
      chat_id: ALLOWED_CHAT_ID,
      user_id: MEMBER_A.id,
      raw: RAW,
      status: "processing",
      attempts: 1,
      last_error: null,
      received_at: NOW.toISOString(),
      claimed_at: NOW.toISOString(),
      finished_at: null,
    });
  });

  it("records the kind and a missing sender", async () => {
    await claimUpdate(db, claimInput({ updateId: 5, kind: "callback_query" }));
    await claimUpdate(db, claimInput({ updateId: 6, kind: "edited_message" }));
    await claimUpdate(db, claimInput({ updateId: 7, userId: null }));
    expect((await readRow(5))?.kind).toBe("callback_query");
    expect((await readRow(6))?.kind).toBe("edited_message");
    expect((await readRow(7))?.user_id).toBeNull();
  });

  it.each([1, 2])("claims a failed record with %i attempts again", async (attempts) => {
    const receivedAt = ago(30_000);
    await seed({ status: "failed", attempts, receivedAt, claimedAt: ago(10_000), lastError: "boom" });
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "claimed", attempt: attempts + 1 });
    const row = await readRow();
    expect(row?.status).toBe("processing");
    expect(row?.attempts).toBe(attempts + 1);
    expect(row?.claimed_at).toBe(NOW.toISOString());
    expect(row?.received_at).toBe(receivedAt.toISOString());
    expect(row?.raw).toBe(RAW);
  });

  it.each(["done", "parked"] as const)("does not claim a %s record and leaves it unchanged", async (status) => {
    await seed({ status, attempts: status === "parked" ? 3 : 1, claimedAt: ago(600_000) });
    const before = await readRow();
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "finished" });
    expect(await readRow()).toEqual(before);
  });

  it("holds the lease at 119.999 seconds", async () => {
    await seed({ status: "processing", attempts: 1, claimedAt: ago(119_999) });
    const before = await readRow();
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "in_progress" });
    expect(await readRow()).toEqual(before);
  });

  it("holds the lease at exactly 120.000 seconds", async () => {
    await seed({ status: "processing", attempts: 1, claimedAt: ago(120_000) });
    const before = await readRow();
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "in_progress" });
    expect(await readRow()).toEqual(before);
  });

  it("claims an abandoned attempt at 120.001 seconds", async () => {
    await seed({ status: "processing", attempts: 1, claimedAt: ago(120_001) });
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "claimed", attempt: 2 });
    const row = await readRow();
    expect(row?.status).toBe("processing");
    expect(row?.attempts).toBe(2);
    expect(row?.claimed_at).toBe(NOW.toISOString());
  });

  it("claims an abandoned second attempt as the third", async () => {
    await seed({ status: "processing", attempts: 2, claimedAt: ago(600_000) });
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "claimed", attempt: 3 });
  });

  it("does not claim a processing record with 3 attempts whose lease is held", async () => {
    await seed({ status: "processing", attempts: 3, claimedAt: ago(120_000) });
    const before = await readRow();
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "in_progress" });
    expect(await readRow()).toEqual(before);
  });

  it("parks an abandoned third attempt", async () => {
    await seed({ status: "processing", attempts: 3, claimedAt: ago(120_001) });
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "exhausted" });
    const row = await readRow();
    expect(row?.status).toBe("parked");
    expect(row?.attempts).toBe(3);
  });

  it("parks a failed record that has used 3 attempts", async () => {
    await seed({ status: "failed", attempts: 3, claimedAt: ago(10_000), lastError: "boom" });
    expect(await claimUpdate(db, claimInput())).toEqual({ outcome: "exhausted" });
    const row = await readRow();
    expect(row?.status).toBe("parked");
    expect(row?.attempts).toBe(3);
    expect(row?.last_error).toBe("boom");
  });
});

describe("finishUpdate", () => {
  it("marks a processing record done", async () => {
    await claimUpdate(db, claimInput());
    await finishUpdate(db, 77, later(2_000));
    const row = await readRow();
    expect(row?.status).toBe("done");
    expect(row?.attempts).toBe(1);
    expect(row?.finished_at).toBe(later(2_000).toISOString());
  });

  it("changes only a processing record", async () => {
    await seed({ status: "parked", attempts: 3 });
    const before = await readRow();
    await finishUpdate(db, 77, NOW);
    expect(await readRow()).toEqual(before);
  });
});

describe("failUpdate", () => {
  it("marks the first attempt failed with the error message", async () => {
    await claimUpdate(db, claimInput());
    expect(await failUpdate(db, 77, new Error("handler broke"), later(1_000))).toBe("failed");
    const row = await readRow();
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBe("handler broke");
  });

  it("marks the second attempt failed", async () => {
    await seed({ status: "processing", attempts: 2, claimedAt: NOW });
    expect(await failUpdate(db, 77, new Error("again"), NOW)).toBe("failed");
    expect((await readRow())?.status).toBe("failed");
  });

  it("parks the third attempt with the error message", async () => {
    await seed({ status: "processing", attempts: 3, claimedAt: NOW });
    expect(await failUpdate(db, 77, new Error("third time"), later(1_000))).toBe("parked");
    const row = await readRow();
    expect(row?.status).toBe("parked");
    expect(row?.attempts).toBe(3);
    expect(row?.last_error).toBe("third time");
  });

  it("cuts an error message of more than 500 characters to its first 500", async () => {
    await claimUpdate(db, claimInput());
    const message = `${"a".repeat(250)}${"b".repeat(250)}${"c".repeat(100)}`;
    await failUpdate(db, 77, new Error(message), NOW);
    const stored = (await readRow())?.last_error;
    expect(stored).toHaveLength(500);
    expect(stored).toBe(message.slice(0, 500));
  });

  it("keeps an error message of exactly 500 characters whole", async () => {
    await claimUpdate(db, claimInput());
    const message = "x".repeat(500);
    await failUpdate(db, 77, new Error(message), NOW);
    expect((await readRow())?.last_error).toBe(message);
  });
});

describe("getLastReceivedAt", () => {
  it("returns null when the log holds no update", async () => {
    expect(await getLastReceivedAt(db, 77)).toBeNull();
  });

  it("returns null when the log holds only the excluded update", async () => {
    await seed({ updateId: 77, status: "processing", attempts: 1, receivedAt: NOW });
    expect(await getLastReceivedAt(db, 77)).toBeNull();
  });

  it("returns the newest time received among the other records, whatever their status", async () => {
    await seed({ updateId: 1, status: "done", attempts: 1, receivedAt: ago(90_000) });
    await seed({ updateId: 2, status: "parked", attempts: 3, receivedAt: ago(30_000) });
    await seed({ updateId: 3, status: "failed", attempts: 1, receivedAt: ago(60_000) });
    await seed({ updateId: 77, status: "processing", attempts: 1, receivedAt: NOW });
    expect(await getLastReceivedAt(db, 77)).toBe(ago(30_000).toISOString());
  });

  it("excludes the given update even when a lower id is newer", async () => {
    await seed({ updateId: 900, status: "done", attempts: 1, receivedAt: ago(90_000) });
    await seed({ updateId: 4, status: "processing", attempts: 1, receivedAt: NOW });
    expect(await getLastReceivedAt(db, 4)).toBe(ago(90_000).toISOString());
    expect(await getLastReceivedAt(db, 900)).toBe(NOW.toISOString());
  });
});

describe("getParked", () => {
  it("returns a count of 0 and no ids when nothing is parked", async () => {
    await seed({ updateId: 1, status: "done", attempts: 1 });
    await seed({ updateId: 2, status: "failed", attempts: 3 });
    expect(await getParked(db, 5)).toEqual({ count: 0, ids: [] });
  });

  it("orders the ids by time received, most recent first", async () => {
    await seed({ updateId: 1001, status: "parked", attempts: 3, receivedAt: ago(60_000) });
    await seed({ updateId: 1002, status: "parked", attempts: 3, receivedAt: ago(30_000) });
    expect(await getParked(db, 5)).toEqual({ count: 2, ids: [1002, 1001] });
  });

  it("puts the most recent first even when its id is the lowest", async () => {
    await seed({ updateId: 5000, status: "parked", attempts: 3, receivedAt: ago(60_000) });
    await seed({ updateId: 17, status: "parked", attempts: 3, receivedAt: ago(30_000) });
    expect(await getParked(db, 5)).toEqual({ count: 2, ids: [17, 5000] });
  });

  it("orders records received at the same time by the highest id first", async () => {
    await seed({ updateId: 1001, status: "parked", attempts: 3, receivedAt: NOW });
    await seed({ updateId: 1002, status: "parked", attempts: 3, receivedAt: NOW });
    expect(await getParked(db, 5)).toEqual({ count: 2, ids: [1002, 1001] });
  });

  it("counts every parked record and returns at most the limit", async () => {
    for (let i = 1; i <= 7; i++) {
      await seed({ updateId: 100 + i, status: "parked", attempts: 3, receivedAt: ago(70_000 - i * 10_000) });
    }
    await seed({ updateId: 999, status: "done", attempts: 1, receivedAt: NOW });
    expect(await getParked(db, 5)).toEqual({ count: 7, ids: [107, 106, 105, 104, 103] });
  });
});

interface MemberRow {
  user_id: number;
  display_name: string;
  username: string | null;
  first_seen_at: string;
  updated_at: string;
}

async function readMember(userId = MEMBER_A.id): Promise<MemberRow | null> {
  return db.prepare("SELECT * FROM members WHERE user_id = ?").bind(userId).first<MemberRow>();
}

describe("refreshMember", () => {
  const sender = { userId: MEMBER_A.id, firstName: MEMBER_A.firstName, username: MEMBER_A.username };

  it("creates the record for a new member", async () => {
    expect(await refreshMember(db, sender, NOW)).toEqual({ userId: MEMBER_A.id, displayName: MEMBER_A.firstName });
    expect(await readMember()).toEqual({
      user_id: MEMBER_A.id,
      display_name: MEMBER_A.firstName,
      username: MEMBER_A.username,
      first_seen_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  it("stores no username when the sender has none", async () => {
    await refreshMember(db, { userId: MEMBER_A.id, firstName: "Ana" }, NOW);
    expect((await readMember())?.username).toBeNull();
  });

  it("writes nothing when the name and username are unchanged", async () => {
    await refreshMember(db, sender, NOW);
    expect(await refreshMember(db, sender, later(60_000))).toEqual({
      userId: MEMBER_A.id,
      displayName: MEMBER_A.firstName,
    });
    const row = await readMember();
    expect(row?.updated_at).toBe(NOW.toISOString());
    expect(row?.first_seen_at).toBe(NOW.toISOString());
  });

  it("updates the display name when the first name changed", async () => {
    await refreshMember(db, sender, NOW);
    expect(await refreshMember(db, { ...sender, firstName: "Anna" }, later(60_000))).toEqual({
      userId: MEMBER_A.id,
      displayName: "Anna",
    });
    const row = await readMember();
    expect(row?.display_name).toBe("Anna");
    expect(row?.updated_at).toBe(later(60_000).toISOString());
    expect(row?.first_seen_at).toBe(NOW.toISOString());
  });

  it("updates the username when it changed or was removed", async () => {
    await refreshMember(db, sender, NOW);
    await refreshMember(db, { ...sender, username: "ana_new" }, later(1_000));
    expect(await readMember()).toMatchObject({ username: "ana_new", updated_at: later(1_000).toISOString() });
    await refreshMember(db, { userId: MEMBER_A.id, firstName: MEMBER_A.firstName }, later(2_000));
    expect(await readMember()).toMatchObject({ username: null, updated_at: later(2_000).toISOString() });
  });
});

describe("getMember", () => {
  it("returns null for an unknown user", async () => {
    expect(await getMember(db, MEMBER_A.id)).toBeNull();
  });

  it("returns the user id and display name", async () => {
    await db
      .prepare(
        "INSERT INTO members (user_id, display_name, username, first_seen_at, updated_at) VALUES (?, 'Ana', 'ana', ?, ?)",
      )
      .bind(MEMBER_A.id, NOW.toISOString(), NOW.toISOString())
      .run();
    expect(await getMember(db, MEMBER_A.id)).toEqual({ userId: MEMBER_A.id, displayName: "Ana" });
  });
});

async function storeSetting(value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(value, NOW.toISOString())
    .run();
}

describe("allowed chat id setting", () => {
  it("is null when none is stored", async () => {
    expect(await getAllowedChatId(db)).toBeNull();
  });

  it("stores the id as text and reads it back as a number", async () => {
    await setAllowedChatId(db, ALLOWED_CHAT_ID, NOW);
    const row = await db
      .prepare("SELECT value, updated_at FROM settings WHERE key = 'allowed_chat_id'")
      .first<{ value: string; updated_at: string }>();
    expect(row).toEqual({ value: String(ALLOWED_CHAT_ID), updated_at: NOW.toISOString() });
    expect(await getAllowedChatId(db)).toBe(ALLOWED_CHAT_ID);
  });

  it("replaces a stored id", async () => {
    await setAllowedChatId(db, -412345678, NOW);
    await setAllowedChatId(db, ALLOWED_CHAT_ID, later(1_000));
    const rows = await db.prepare("SELECT value, updated_at FROM settings").all<{ value: string; updated_at: string }>();
    expect(rows.results).toEqual([{ value: String(ALLOWED_CHAT_ID), updated_at: later(1_000).toISOString() }]);
    expect(await getAllowedChatId(db)).toBe(ALLOWED_CHAT_ID);
  });

  it("reads a stored whole number written by the operator", async () => {
    await storeSetting("-1001234567890");
    expect(await getAllowedChatId(db)).toBe(-1001234567890);
  });

  it.each(["abc", "1.5", "", "12abc", "-100.25"])("is null for the stored value %j", async (value) => {
    await storeSetting(value);
    expect(await getAllowedChatId(db)).toBeNull();
  });
});
