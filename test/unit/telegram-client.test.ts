import type { ApiCallFn } from "grammy";
import { describe, expect, it } from "vitest";
import {
  MAX_RATE_LIMIT_WAIT_SECONDS,
  TELEGRAM_TIMEOUT_SECONDS,
  telegramClientOptions,
  waitOutShortRateLimits,
} from "../../src/telegram/client";

type Answer = { ok: true; result: unknown } | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } };

const OK: Answer = { ok: true, result: { message_id: 1 } };

function rateLimit(retryAfter?: number): Answer {
  return {
    ok: false,
    error_code: 429,
    description: `Too Many Requests: retry after ${retryAfter ?? 5}`,
    ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
  };
}

/** Runs one call through the transformer, with `prev` answering from `answers` in turn. */
async function call(answers: Answer[]): Promise<{ result: unknown; calls: number; waits: number[] }> {
  let calls = 0;
  const waits: number[] = [];
  const prev = (async () => answers[calls++] ?? OK) as unknown as ApiCallFn;
  const transformer = waitOutShortRateLimits(async (ms) => {
    waits.push(ms);
  });
  const result = await transformer(prev, "sendMessage", { chat_id: 1, text: "hi" });
  return { result, calls, waits };
}

describe("telegramClientOptions", () => {
  it("times a call out after 20 seconds", () => {
    expect(TELEGRAM_TIMEOUT_SECONDS).toBe(20);
    expect(telegramClientOptions().timeoutSeconds).toBe(20);
  });
});

describe("waitOutShortRateLimits", () => {
  it("passes a success through with one call and no wait", async () => {
    expect(await call([OK])).toEqual({ result: OK, calls: 1, waits: [] });
  });

  it("waits out a short rate limit once and returns the second answer", async () => {
    expect(await call([rateLimit(3), OK])).toEqual({ result: OK, calls: 2, waits: [3000] });
  });

  it("waits out a rate limit of exactly the longest wait", async () => {
    const outcome = await call([rateLimit(MAX_RATE_LIMIT_WAIT_SECONDS), OK]);
    expect(outcome.waits).toEqual([MAX_RATE_LIMIT_WAIT_SECONDS * 1000]);
    expect(outcome.result).toEqual(OK);
  });

  it("returns a longer rate limit at once", async () => {
    const limit = rateLimit(MAX_RATE_LIMIT_WAIT_SECONDS + 1);
    expect(await call([limit])).toEqual({ result: limit, calls: 1, waits: [] });
  });

  it("returns a rate limit without retry_after at once", async () => {
    const limit = rateLimit();
    expect(await call([limit])).toEqual({ result: limit, calls: 1, waits: [] });
  });

  it("returns a second rate limit in a row", async () => {
    const second = rateLimit(2);
    expect(await call([rateLimit(1), second])).toEqual({ result: second, calls: 2, waits: [1000] });
  });

  it("returns any other error at once", async () => {
    const refused: Answer = { ok: false, error_code: 400, description: "Bad Request", parameters: { retry_after: 1 } };
    expect(await call([refused])).toEqual({ result: refused, calls: 1, waits: [] });
  });
});
