import type { UserFromGetMe } from "grammy/types";

export interface Config {
  botToken: string;
  botInfo: UserFromGetMe;
  memberIds: readonly number[];
  timezone: string;
}

export type SettingName = "BOT_TOKEN" | "BOT_INFO" | "ALLOWED_USER_IDS" | "HOUSEHOLD_TZ";

export class ConfigError extends Error {
  readonly setting: SettingName;
  constructor(setting: SettingName, message: string) {
    super(message);
    this.name = "ConfigError";
    this.setting = setting;
  }
}

/**
 * Reads and validates the gateway's configuration (Decision 3, D23, D49).
 * Throws a ConfigError naming the first setting that is missing or invalid.
 */
export function readConfig(env: Env): Config {
  const settings = env as unknown as Record<SettingName, unknown>;
  return {
    botToken: readBotToken(settings.BOT_TOKEN),
    botInfo: readBotInfo(settings.BOT_INFO),
    memberIds: readMemberIds(settings.ALLOWED_USER_IDS),
    timezone: readTimezone(settings.HOUSEHOLD_TZ),
  };
}

function readBotToken(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new ConfigError("BOT_TOKEN", "BOT_TOKEN is missing or empty");
  }
  return value;
}

function readBotInfo(value: unknown): UserFromGetMe {
  const parsed = parseJsonSetting("BOT_INFO", value);
  if (!isPlainObject(parsed)) {
    throw new ConfigError("BOT_INFO", "BOT_INFO is not a JSON object");
  }
  const id = parsed["id"];
  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    throw new ConfigError("BOT_INFO", "BOT_INFO has no numeric id");
  }
  const username = parsed["username"];
  if (typeof username !== "string" || username === "") {
    throw new ConfigError("BOT_INFO", "BOT_INFO has no username");
  }
  return parsed as unknown as UserFromGetMe;
}

function readMemberIds(value: unknown): readonly number[] {
  const parsed = parseJsonSetting("ALLOWED_USER_IDS", value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ConfigError("ALLOWED_USER_IDS", "ALLOWED_USER_IDS is not a non-empty list");
  }
  const ids: number[] = [];
  for (const entry of parsed) {
    const id = toUserId(entry);
    if (id === null) {
      throw new ConfigError("ALLOWED_USER_IDS", "ALLOWED_USER_IDS holds a value that is not a user id");
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function readTimezone(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new ConfigError("HOUSEHOLD_TZ", "HOUSEHOLD_TZ is missing or empty");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new ConfigError("HOUSEHOLD_TZ", "HOUSEHOLD_TZ is not a timezone the runtime accepts");
  }
  return value;
}

/** A setting given as JSON text is parsed; any other value is taken as already parsed. */
function parseJsonSetting(setting: SettingName, value: unknown): unknown {
  if (value === undefined || value === null) {
    throw new ConfigError(setting, `${setting} is missing`);
  }
  if (typeof value !== "string") return value;
  if (value === "") throw new ConfigError(setting, `${setting} is empty`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ConfigError(setting, `${setting} is not valid JSON`);
  }
}

/** A positive whole number, given as a number or as a string of digits; otherwise null. */
function toUserId(value: unknown): number | null {
  let id: number;
  if (typeof value === "number") {
    id = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    id = Number(value);
  } else {
    return null;
  }
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
