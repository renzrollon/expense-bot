import type { ApiClientOptions, Transformer } from "grammy";

/**
 * How every Telegram call is made, by the gateway and by the scheduler. A call that
 * hangs is aborted well inside the gateway's 120-second update lease. A rate limit
 * that asks for a short wait is waited out once, inside the attempt; a longer one, or
 * a second one in a row, fails the call as before.
 *
 * Worst case for one call: 20 s, a 10 s wait, and 20 s again. A handler that makes two
 * calls in a row still ends before the lease does.
 */

/** grammY's default is 500 seconds, longer than the gateway's lease. */
export const TELEGRAM_TIMEOUT_SECONDS = 20;

/** The longest `retry_after` that is waited out instead of failing the call. */
export const MAX_RATE_LIMIT_WAIT_SECONDS = 10;

export type Sleep = (ms: number) => Promise<void>;

const sleepFor: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The client options for a grammY `Bot` or `Api`. */
export function telegramClientOptions(): ApiClientOptions {
  return {
    // Look up the global fetch at call time, so tests can replace it.
    fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch,
    timeoutSeconds: TELEGRAM_TIMEOUT_SECONDS,
  };
}

/**
 * An API transformer: when Telegram answers 429 with a `retry_after` of at most
 * `MAX_RATE_LIMIT_WAIT_SECONDS`, wait that long and make the call once more. Any other
 * answer, and the answer to the second call, is returned unchanged.
 */
export function waitOutShortRateLimits(sleep: Sleep = sleepFor): Transformer {
  return async (prev, method, payload, signal) => {
    const result = await prev(method, payload, signal);
    if (result.ok || result.error_code !== 429) return result;
    const wait = result.parameters?.retry_after;
    if (wait === undefined || wait > MAX_RATE_LIMIT_WAIT_SECONDS) return result;
    await sleep(wait * 1000);
    return prev(method, payload, signal);
  };
}
