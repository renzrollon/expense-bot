import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Update } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateway } from "../src/gateway";
import type { FeatureModule } from "../src/gateway/registry";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./helpers/constants";
import { failingDb, useCleanTables } from "./helpers/db";
import { probeModule } from "./helpers/probe";
import { signedRequest } from "./helpers/requests";
import { installTelegramStub, type TelegramStub } from "./helpers/telegram";
import { messageUpdate } from "./helpers/updates";

const START = new Date("2026-09-29T10:00:00.000Z");
const LEASE_MS = 120_000;

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

useCleanTables(env.DB);

let telegram: TelegramStub;
let now: Date;

beforeEach(async () => {
  telegram = installTelegramStub();
  now = START;
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('allowed_chat_id', ?, ?)")
    .bind(String(ALLOWED_CHAT_ID), START.toISOString())
    .run();
});

afterEach(() => {
  telegram.restore();
});

function gatewayWith(modules: FeatureModule[]) {
  return createGateway({ modules, now: () => now });
}

async function send(
  modules: FeatureModule[] | ReturnType<typeof gatewayWith>,
  update: Update,
  options: { env?: Env; body?: string } = {},
): Promise<Response> {
  const gateway = Array.isArray(modules) ? gatewayWith(modules) : modules;
  const ctx = createExecutionContext();
  const request = signedRequest(update, options.body === undefined ? {} : { body: options.body });
  const response = await gateway.fetch(request, options.env ?? env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function readRecord(updateId: number): Promise<UpdateRow | null> {
  return env.DB.prepare("SELECT * FROM updates WHERE update_id = ?").bind(updateId).first<UpdateRow>();
}

async function insertRecord(
  update: Update,
  fields: { status: string; attempts: number; claimedAt: Date; lastError?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO updates (update_id, kind, chat_id, user_id, raw, status, attempts, last_error, received_at, claimed_at)
     VALUES (?, 'message', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      update.update_id,
      ALLOWED_CHAT_ID,
      MEMBER_A.id,
      JSON.stringify(update),
      fields.status,
      fields.attempts,
      fields.lastError ?? null,
      new Date(fields.claimedAt.getTime() - 1_000).toISOString(),
      fields.claimedAt.toISOString(),
    )
    .run();
}

async function expectEmpty200(response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
}

function secondsLater(seconds: number): Date {
  return new Date(now.getTime() + seconds * 1_000);
}

describe("Update log", () => {
  it("Accepted update is recorded", async () => {
    const seenDuringHandler: (UpdateRow | null)[] = [];
    const recorder: FeatureModule = {
      name: "recorder",
      messages: [
        async () => {
          seenDuringHandler.push(await readRecord(501));
        },
      ],
    };
    const update = messageUpdate({ text: "coffee 120", updateId: 501 });
    const body = JSON.stringify(update, null, 2);

    const response = await send([recorder], update, { body });

    await expectEmpty200(response);
    const row = await readRecord(501);
    expect(row).toMatchObject({
      update_id: 501,
      kind: "message",
      chat_id: ALLOWED_CHAT_ID,
      user_id: MEMBER_A.id,
      raw: body,
      received_at: START.toISOString(),
    });
    expect(seenDuringHandler).toHaveLength(1);
    expect(seenDuringHandler[0]).toMatchObject({ update_id: 501, status: "processing", raw: body });
  });

  it("Successful update is marked done", async () => {
    const probe = probeModule({ messages: ["only"] });

    const response = await send([probe.module], messageUpdate({ text: "coffee 120", updateId: 502 }));

    await expectEmpty200(response);
    expect(probe.callsTo("message:only")).toHaveLength(1);
    expect(await readRecord(502)).toMatchObject({ status: "done", attempts: 1 });
  });

  it("Update that no handler takes is marked done", async () => {
    const gateway = gatewayWith([probeModule({ commands: ["known"] }).module]);

    const unknownCommand = await send(gateway, messageUpdate({ text: "/unknown", updateId: 503 }));
    const plainMessage = await send(gateway, messageUpdate({ text: "coffee 120", updateId: 504 }));

    await expectEmpty200(unknownCommand);
    await expectEmpty200(plainMessage);
    expect(await readRecord(503)).toMatchObject({ status: "done", attempts: 1 });
    expect(await readRecord(504)).toMatchObject({ status: "done", attempts: 1 });
    expect(telegram.calls).toEqual([]);
  });
});

describe("At-most-once processing", () => {
  it("Processed update is redelivered", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 510 });
    await insertRecord(update, { status: "done", attempts: 1, claimedAt: secondsLater(-30) });
    const before = await readRecord(510);

    const response = await send([probe.module], update);

    await expectEmpty200(response);
    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
    expect(await readRecord(510)).toEqual(before);
  });

  it("Update id lower than earlier ones", async () => {
    const probe = probeModule({ messages: ["only"] });
    await insertRecord(messageUpdate({ text: "a", updateId: 900 }), {
      status: "done",
      attempts: 1,
      claimedAt: secondsLater(-60),
    });
    await insertRecord(messageUpdate({ text: "b", updateId: 950 }), {
      status: "done",
      attempts: 1,
      claimedAt: secondsLater(-30),
    });

    const response = await send([probe.module], messageUpdate({ text: "coffee 120", updateId: 100 }));

    await expectEmpty200(response);
    expect(probe.callsTo("message:only")).toHaveLength(1);
    expect(await readRecord(100)).toMatchObject({ status: "done", attempts: 1 });
  });

  it("Outcome cannot be recorded after success", async () => {
    const failing = failingDb(env.DB);
    let handlerRan = false;
    const module: FeatureModule = {
      name: "breaker",
      messages: [
        async () => {
          handlerRan = true;
          failing.failAll();
        },
      ],
    };

    const response = await send([module], messageUpdate({ text: "coffee 120", updateId: 520 }), {
      env: { ...env, DB: failing.db },
    });
    failing.heal();

    await expectEmpty200(response);
    expect(handlerRan).toBe(true);
    expect(await readRecord(520)).toMatchObject({ status: "processing", attempts: 1 });
  });
});

describe("Retry on redelivery", () => {
  it("Handler fails on the first attempt", async () => {
    const probe = probeModule({ messages: ["only"] });
    probe.failWith(new Error("sheet is locked"));

    const response = await send([probe.module], messageUpdate({ text: "coffee 120", updateId: 530 }));

    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await readRecord(530)).toMatchObject({
      status: "failed",
      attempts: 1,
      last_error: "sheet is locked",
    });
  });

  it("Retry succeeds", async () => {
    const probe = probeModule({ messages: ["only"] });
    const gateway = gatewayWith([probe.module]);
    const update = messageUpdate({ text: "coffee 120", updateId: 531 });
    probe.failWith(new Error("temporary"));

    const first = await send(gateway, update);
    probe.clearFailure();
    now = secondsLater(5);
    const second = await send(gateway, update);

    expect(first.status).toBe(500);
    await expectEmpty200(second);
    expect(probe.callsTo("message:only")).toHaveLength(2);
    expect(await readRecord(531)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("Every handler runs again on a retry", async () => {
    const probe = probeModule({ messages: ["first", "second"] });
    const gateway = gatewayWith([probe.module]);
    const update = messageUpdate({ text: "coffee 120", updateId: 532 });
    probe.failWith(new Error("second failed"), "message:second");

    const first = await send(gateway, update);
    probe.clearFailure();
    now = secondsLater(5);
    const second = await send(gateway, update);

    expect(first.status).toBe(500);
    await expectEmpty200(second);
    expect(probe.calls.map((call) => call.handler)).toEqual([
      "message:first",
      "message:second",
      "message:first",
      "message:second",
    ]);
  });

  it("Failure cannot be recorded", async () => {
    const failing = failingDb(env.DB);
    const module: FeatureModule = {
      name: "breaker",
      messages: [
        async () => {
          failing.failAll();
          throw new Error("handler failed");
        },
      ],
    };

    const response = await send([module], messageUpdate({ text: "coffee 120", updateId: 533 }), {
      env: { ...env, DB: failing.db },
    });
    failing.heal();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(await readRecord(533)).toMatchObject({ status: "processing", attempts: 1 });
  });

  it("Long error message is cut", async () => {
    const probe = probeModule({ messages: ["only"] });
    const head = "a".repeat(250) + "b".repeat(250);
    probe.failWith(new Error(head + "c".repeat(120)));

    const response = await send([probe.module], messageUpdate({ text: "coffee 120", updateId: 534 }));

    expect(response.status).toBe(500);
    expect(await readRecord(534)).toMatchObject({ status: "failed", last_error: head });
  });
});

describe("Parking after three failed attempts", () => {
  it("Third attempt fails", async () => {
    const probe = probeModule({ messages: ["only"] });
    const gateway = gatewayWith([probe.module]);
    const update = messageUpdate({ text: "coffee 120", updateId: 540 });
    probe.failWith(new Error("still broken"));

    const first = await send(gateway, update);
    now = secondsLater(5);
    const second = await send(gateway, update);
    now = secondsLater(5);
    const third = await send(gateway, update);

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    await expectEmpty200(third);
    expect(probe.callsTo("message:only")).toHaveLength(3);
    expect(await readRecord(540)).toMatchObject({
      status: "parked",
      attempts: 3,
      last_error: "still broken",
    });
  });

  it("Parked update is redelivered", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 541 });
    await insertRecord(update, {
      status: "parked",
      attempts: 3,
      claimedAt: secondsLater(-30),
      lastError: "still broken",
    });
    const before = await readRecord(541);

    const response = await send([probe.module], update);

    await expectEmpty200(response);
    expect(probe.calls).toEqual([]);
    expect(await readRecord(541)).toEqual(before);
  });

  it("Failed record that has used three attempts", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 542 });
    await insertRecord(update, {
      status: "failed",
      attempts: 3,
      claimedAt: secondsLater(-10),
      lastError: "still broken",
    });

    const response = await send([probe.module], update);

    await expectEmpty200(response);
    expect(probe.calls).toEqual([]);
    expect(await readRecord(542)).toMatchObject({ status: "parked", attempts: 3 });
  });
});

describe("Recovery of abandoned attempts", () => {
  it("Duplicate while an attempt is in progress", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 550 });
    await insertRecord(update, { status: "processing", attempts: 1, claimedAt: secondsLater(-60) });
    const before = await readRecord(550);

    const response = await send([probe.module], update);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(probe.calls).toEqual([]);
    expect(await readRecord(550)).toEqual(before);
  });

  it("Attempt started exactly 120 seconds ago", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 551 });
    await insertRecord(update, {
      status: "processing",
      attempts: 1,
      claimedAt: new Date(now.getTime() - LEASE_MS),
    });

    const response = await send([probe.module], update);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(probe.calls).toEqual([]);
  });

  it("Abandoned attempt is retried", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 552 });
    await insertRecord(update, {
      status: "processing",
      attempts: 1,
      claimedAt: new Date(now.getTime() - LEASE_MS - 1),
    });

    const response = await send([probe.module], update);

    await expectEmpty200(response);
    expect(probe.callsTo("message:only")).toHaveLength(1);
    expect(await readRecord(552)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("Abandoned third attempt is parked", async () => {
    const probe = probeModule({ messages: ["only"] });
    const update = messageUpdate({ text: "coffee 120", updateId: 553 });
    await insertRecord(update, {
      status: "processing",
      attempts: 3,
      claimedAt: new Date(now.getTime() - LEASE_MS - 1),
    });

    const response = await send([probe.module], update);

    await expectEmpty200(response);
    expect(probe.calls).toEqual([]);
    expect(await readRecord(553)).toMatchObject({ status: "parked", attempts: 3 });
  });
});

describe("Database unavailable", () => {
  it("Settings cannot be read", async () => {
    const probe = probeModule({ messages: ["only"] });
    const failing = failingDb(env.DB);
    failing.failAll();

    const response = await send([probe.module], messageUpdate({ text: "coffee 120", updateId: 560 }), {
      env: { ...env, DB: failing.db },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
  });

  it("Update cannot be claimed", async () => {
    const probe = probeModule({ messages: ["only"] });
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => sql.startsWith("INSERT INTO updates"));

    const response = await send([probe.module], messageUpdate({ text: "coffee 120", updateId: 561 }), {
      env: { ...env, DB: failing.db },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(probe.calls).toEqual([]);
    expect(telegram.calls).toEqual([]);
    expect(await readRecord(561)).toBeNull();
  });
});
