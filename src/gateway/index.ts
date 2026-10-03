import { BotError } from "grammy";
import type { Update } from "grammy/types";
import { buildBot, type GatewayState } from "./bot";
import { classifyUpdate, type Decision } from "./classify";
import { ConfigError, readConfig, type Config } from "./config";
import { failureReason } from "./failure";
import { refreshMember } from "./members";
import { buildRegistry, type FeatureModule, type Registry } from "./registry";
import { secretMatches } from "./secret";
import { getAllowedChatId, setAllowedChatId } from "./settings";
import { claimUpdate, failUpdate, finishUpdate, RETRY_AFTER_SECONDS } from "./update-log";

export interface GatewayOptions {
  modules: FeatureModule[];
  now?: () => Date;
}

export interface Gateway {
  registry: Registry;
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

const WEBHOOK_PATH = "/webhook";
const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

type Processed = Extract<Decision, { action: "process" | "migrate" }>;

/**
 * Builds and validates the registry at once, so an invalid registration throws
 * RegistrationError at module scope, and returns the request pipeline (Decision 3).
 */
export function createGateway(options: GatewayOptions): Gateway {
  const registry = buildRegistry(options.modules);
  const now = options.now ?? (() => new Date());

  const fetch = async (request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> => {
    // Step 1: method and path (D22).
    if (request.method !== "POST" || new URL(request.url).pathname !== WEBHOOK_PATH) {
      return new Response(null, { status: 404 });
    }

    // Step 2: the secret, before the body is read (Decision 4).
    const expected = (env as unknown as { WEBHOOK_SECRET?: unknown }).WEBHOOK_SECRET;
    if (!secretMatches(request.headers.get(SECRET_HEADER), typeof expected === "string" ? expected : undefined)) {
      return empty(401);
    }

    // Step 3: configuration fails closed (D23). No Retry-After (D54).
    let config: Config;
    try {
      config = readConfig(env);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      log({ event: "config_invalid", setting: error.setting });
      return empty(500);
    }

    // Step 4: the body is a JSON object with a numeric update id. The text is kept as received (D47).
    const raw = await request.text();
    const update = parseUpdate(raw);
    if (update === null) {
      log({ event: "body_rejected" });
      return empty(200);
    }
    const updateId = update.update_id;

    // Step 5: the allowed chat id, read for each update.
    const db = env.DB;
    let allowedChatId: number | null;
    try {
      allowedChatId = await getAllowedChatId(db);
    } catch {
      log({ event: "database_unavailable", update_id: updateId });
      return empty(503);
    }

    // Step 6: classify. The function is total; an error here is a gateway bug, answered 200 (D36).
    let decision: Decision;
    try {
      decision = classifyUpdate(update, allowedChatId, config.memberIds);
    } catch {
      log({ event: "update_rejected", update_id: updateId });
      return empty(200);
    }
    if (decision.action === "ignore") {
      log({ event: "update_ignored", update_id: updateId, reason: decision.reason });
      return empty(200);
    }

    // Step 7: claim (Decision 6).
    const at = now();
    let attempt: number;
    try {
      const claim = await claimUpdate(db, {
        updateId,
        kind: decision.kind,
        chatId: decision.chatId,
        userId: decision.userId,
        raw,
        now: at,
      });
      if (claim.outcome === "in_progress") return empty(503, RETRY_AFTER_SECONDS);
      if (claim.outcome !== "claimed") return empty(200);
      attempt = claim.attempt;
    } catch {
      log({ event: "database_unavailable", update_id: updateId });
      return empty(503);
    }

    // Steps 8 and 9: the attempt.
    try {
      await runAttempt(decision, update, config, env, registry, at);
    } catch (thrown) {
      const error = thrown instanceof BotError ? thrown.error : thrown;
      let status: number;
      let retryAfter: number | undefined;
      try {
        const recorded = await failUpdate(db, updateId, error, now());
        status = recorded === "parked" ? 200 : 500;
        retryAfter = recorded === "parked" ? undefined : RETRY_AFTER_SECONDS;
      } catch {
        // The lease recovers the record. No Retry-After (D54).
        log({ event: "attempt_failed", update_id: updateId, attempt, status: 503, reason: failureReason(error) });
        log({ event: "outcome_not_recorded", update_id: updateId });
        return empty(503);
      }
      log({ event: "attempt_failed", update_id: updateId, attempt, status, reason: failureReason(error) });
      return empty(status, retryAfter);
    }

    // Step 10: success wins over bookkeeping.
    try {
      await finishUpdate(db, updateId, now());
    } catch {
      log({ event: "outcome_not_recorded", update_id: updateId });
    }
    return empty(200);
  };

  return { registry, fetch };
}

/**
 * Step 8 and 9. A migration notice stores the new chat id and reaches no handler (D39).
 * An accepted update refreshes the member record, then runs the handlers on a bot
 * built for this update alone (D50).
 */
async function runAttempt(
  decision: Processed,
  update: Update,
  config: Config,
  env: Env,
  registry: Registry,
  at: Date,
): Promise<void> {
  if (decision.action === "migrate") {
    await setAllowedChatId(env.DB, decision.newChatId, at);
    return;
  }
  const member = await refreshMember(
    env.DB,
    decision.username === undefined
      ? { userId: decision.userId, firstName: decision.firstName }
      : { userId: decision.userId, firstName: decision.firstName, username: decision.username },
    at,
  );
  const state: GatewayState = {
    env,
    db: env.DB,
    now: at,
    timezone: config.timezone,
    chatId: decision.chatId,
    member,
    registry,
  };
  await buildBot(config, state).handleUpdate(update);
}

/** The update when the text is a JSON object with a numeric update id, otherwise null. */
function parseUpdate(raw: string): Update | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const updateId = (parsed as { update_id?: unknown }).update_id;
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) return null;
  return parsed as Update;
}

/** Every response the gateway gives has an empty body. */
function empty(status: number, retryAfterSeconds?: number): Response {
  const headers = retryAfterSeconds === undefined ? undefined : { "Retry-After": String(retryAfterSeconds) };
  return new Response(null, { status, headers });
}

/** One single-line JSON log entry. No entry holds message text, a name or a username. */
function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}
