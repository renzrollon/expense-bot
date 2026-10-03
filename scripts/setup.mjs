// Setup script for the Telegram side of the setup (Decision 12). No dependencies.
// Usage: node scripts/setup.mjs <step> [arguments]
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSecretsFile } from "./lib/secrets-file.mjs";

export const STEPS = ["bot-info", "discover", "secret", "webhook", "verify"];

const STEPS_LINE = `Steps: ${STEPS.join(", ")}`;
const UPDATE_TYPES = ["message", "edited_message", "callback_query"];
const SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const SECRET_LENGTH = 48;
const RECENT_ERROR_SECONDS = 10 * 60;

const TEXT = {
  privacyOn:
    "Privacy mode is on. Turn it off in BotFather with /setprivacy, then remove the bot from the group and add it again.",
  webhookRegistered: 'A webhook is registered. Remove it with "webhook --delete" first.',
  noPending:
    "No pending update found. Send a message in the group, check that privacy mode is off, and run discover again.",
  notHttps: "The address must use HTTPS.",
  tokenMissing: "BOT_TOKEN is missing.",
};

/** Raised for a failure whose text is already the line to print. */
class StepError extends Error {}

/**
 * Runs one setup step and resolves to the process exit code.
 * @param {string[]} argv the arguments after the script name: the step first
 * @param {{ env: Record<string, string | undefined>, fetch: typeof fetch, print: (line: string) => void,
 *   printError: (line: string) => void, readSecretsFile: () => Record<string, string>,
 *   randomBytes: (length: number) => Uint8Array, now: () => Date }} deps
 */
export async function run(argv, deps) {
  const [step, ...rest] = argv;
  if (step === undefined || !STEPS.includes(step)) {
    deps.printError(STEPS_LINE);
    return 1;
  }
  if (step === "secret") return secretStep(deps);

  const settings = readSettings(deps);
  const token = settings("BOT_TOKEN");
  if (token === "") {
    deps.printError(TEXT.tokenMissing);
    return 1;
  }
  const redact = (text) => String(text).split(token).join("<token>");
  const telegram = (method, params) => callTelegram(deps, token, method, params);

  try {
    switch (step) {
      case "bot-info":
        return await botInfoStep(deps, telegram, rest);
      case "discover":
        return await discoverStep(deps, telegram);
      case "webhook":
        return await webhookStep(deps, telegram, rest, settings("WEBHOOK_SECRET"));
      case "verify":
        return await verifyStep(deps, telegram);
    }
  } catch (error) {
    const line = error instanceof StepError ? error.message : `Request failed: ${errorMessage(error)}`;
    deps.printError(redact(line));
    return 1;
  }
  return 1;
}

/** A setting from the environment, or else from the secrets file; "" when neither holds one. */
function readSettings(deps) {
  let file;
  return (name) => {
    const fromEnv = deps.env[name];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    file ??= deps.readSecretsFile() ?? {};
    const fromFile = file[name];
    return typeof fromFile === "string" ? fromFile : "";
  };
}

async function callTelegram(deps, token, method, params = {}) {
  const response = await deps.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  let answer;
  try {
    answer = await response.json();
  } catch {
    throw new StepError(`Telegram error: HTTP ${response.status}`);
  }
  if (!answer || answer.ok !== true) {
    const description = answer?.description ?? `HTTP ${response.status}`;
    throw new StepError(`Telegram error: ${description}`);
  }
  return answer.result;
}

function secretStep(deps) {
  const bytes = deps.randomBytes(SECRET_LENGTH);
  let secret = "";
  // 256 is a multiple of 64, so masking each byte keeps every character equally likely.
  for (let i = 0; i < SECRET_LENGTH; i++) secret += SECRET_ALPHABET[bytes[i] & 63];
  deps.print(secret);
  return 0;
}

async function botInfoStep(deps, telegram, args) {
  const me = await telegram("getMe");
  const json = JSON.stringify(me);
  // With --escaped, the line is the value to paste after "BOT_INFO": in wrangler.jsonc.
  deps.print(args.includes("--escaped") ? JSON.stringify(json) : json);
  if (me && me.can_read_all_group_messages === false) deps.printError(TEXT.privacyOn);
  return 0;
}

async function discoverStep(deps, telegram) {
  const info = await telegram("getWebhookInfo");
  if (info && typeof info.url === "string" && info.url !== "") {
    deps.printError(TEXT.webhookRegistered);
    return 1;
  }
  const updates = await telegram("getUpdates");
  const chats = new Map();
  const senders = new Map();
  for (const update of Array.isArray(updates) ? updates : []) {
    const press = update?.callback_query;
    const message = update?.message ?? update?.edited_message ?? press?.message;
    const sender = press ? press.from : message?.from;
    const chat = message?.chat;
    if (chat && chat.id !== undefined && !chats.has(chat.id)) {
      const title = chat.title ?? sender?.first_name ?? chat.first_name ?? "";
      chats.set(chat.id, `${chat.id}  ${chat.type ?? ""}  ${title}`);
    }
    if (sender && sender.id !== undefined && !senders.has(sender.id)) {
      senders.set(sender.id, `${sender.id}  ${sender.first_name ?? ""}`);
    }
  }
  if (chats.size === 0 && senders.size === 0) {
    deps.printError(TEXT.noPending);
    return 1;
  }
  deps.print("Chats:");
  for (const line of chats.values()) deps.print(line);
  deps.print("Senders:");
  for (const line of senders.values()) deps.print(line);
  return 0;
}

async function webhookStep(deps, telegram, args, secret) {
  const dropPending = args.includes("--drop-pending");
  if (args.includes("--delete")) {
    await telegram("deleteWebhook", dropPending ? { drop_pending_updates: true } : {});
    deps.print("Webhook removed.");
    if (dropPending) deps.print("Pending updates dropped.");
    return 0;
  }
  const reason = secretProblem(secret);
  if (reason !== null) {
    deps.printError(`WEBHOOK_SECRET is invalid: ${reason}`);
    return 1;
  }
  const url = args.find((arg) => !arg.startsWith("--"));
  if (url === undefined || !url.startsWith("https://")) {
    deps.printError(TEXT.notHttps);
    return 1;
  }
  const params = { url, secret_token: secret, allowed_updates: UPDATE_TYPES };
  if (dropPending) params.drop_pending_updates = true;
  await telegram("setWebhook", params);
  deps.print(`Webhook registered: ${url}`);
  if (dropPending) deps.print("Pending updates dropped.");
  return 0;
}

function secretProblem(secret) {
  if (secret === "") return "it is empty";
  if (secret.length > 256) return "it is longer than 256 characters";
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) return "it has a character outside A-Z, a-z, 0-9, _ and -";
  return null;
}

async function verifyStep(deps, telegram) {
  const info = (await telegram("getWebhookInfo")) ?? {};
  if (typeof info.url !== "string" || info.url === "") {
    deps.printError("Problem: no webhook is registered");
    return 1;
  }
  const problems = [];
  const types = Array.isArray(info.allowed_updates) ? info.allowed_updates : [];
  const sameTypes = types.length === UPDATE_TYPES.length && UPDATE_TYPES.every((t) => types.includes(t));
  if (!sameTypes) {
    const list = types.length === 0 ? "the defaults" : types.join(", ");
    problems.push(`the update types are ${list}, expected ${UPDATE_TYPES.join(", ")}`);
  }

  deps.print(`Address: ${info.url}`);
  deps.print(`Pending updates: ${info.pending_update_count ?? 0}`);
  if (typeof info.last_error_date === "number") {
    const ageSeconds = Math.max(0, Math.floor(deps.now().getTime() / 1000) - info.last_error_date);
    const age = `${Math.floor(ageSeconds / 60)} min`;
    const message = info.last_error_message ?? "";
    deps.print(`Last error: ${message} (${age} ago)`);
    if (ageSeconds <= RECENT_ERROR_SECONDS) {
      problems.push(`Telegram recorded a delivery error ${age} ago: ${message}`);
    }
  } else {
    deps.print("Last error: none");
  }

  for (const problem of problems) deps.printError(`Problem: ${problem}`);
  return problems.length === 0 ? 0 : 1;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The dependencies used when the script runs as a program. */
export const realDeps = {
  env: process.env,
  fetch: (...args) => globalThis.fetch(...args),
  print: (line) => process.stdout.write(`${line}\n`),
  printError: (line) => process.stderr.write(`${line}\n`),
  readSecretsFile: () => {
    const path = resolve(scriptDir, "..", ".dev.vars");
    return existsSync(path) ? parseSecretsFile(readFileSync(path, "utf8")) : {};
  },
  randomBytes: (length) => new Uint8Array(nodeRandomBytes(length)),
  now: () => new Date(),
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2), realDeps);
}
