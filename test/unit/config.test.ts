import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ConfigError, readConfig, type SettingName } from "../../src/gateway/config";
import { BOT_INFO, BOT_TOKEN, HOUSEHOLD_TZ, MEMBER_A, MEMBER_B } from "../helpers/constants";

/** A changed copy of the test environment. `undefined` removes a setting. */
function envWith(overrides: Record<string, unknown>): Env {
  return { ...env, ...overrides } as unknown as Env;
}

/** Returns the ConfigError that readConfig throws, and rethrows any other error. */
function configError(changed: Env): ConfigError {
  try {
    readConfig(changed);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("readConfig did not throw");
}

function expectInvalid(setting: SettingName, value: unknown): void {
  const error = configError(envWith({ [setting]: value }));
  expect(error).toBeInstanceOf(ConfigError);
  expect(error.name).toBe("ConfigError");
  expect(error.setting).toBe(setting);
}

describe("readConfig with valid settings", () => {
  it("reads the test configuration", () => {
    const config = readConfig(env);
    expect(config.botToken).toBe(BOT_TOKEN);
    expect(config.botInfo).toEqual(BOT_INFO);
    expect(config.memberIds).toEqual([MEMBER_A.id, MEMBER_B.id]);
    expect(config.timezone).toBe(HOUSEHOLD_TZ);
  });

  it("accepts the bot identity and the member list as parsed values", () => {
    const config = readConfig(envWith({ BOT_INFO, ALLOWED_USER_IDS: [MEMBER_A.id, MEMBER_B.id] }));
    expect(config.botInfo).toEqual(BOT_INFO);
    expect(config.memberIds).toEqual([MEMBER_A.id, MEMBER_B.id]);
  });

  it("accepts member ids given as strings of digits", () => {
    const text = readConfig(envWith({ ALLOWED_USER_IDS: JSON.stringify([`${MEMBER_A.id}`, MEMBER_B.id]) }));
    expect(text.memberIds).toEqual([MEMBER_A.id, MEMBER_B.id]);
    const parsed = readConfig(envWith({ ALLOWED_USER_IDS: [`${MEMBER_A.id}`, `${MEMBER_B.id}`] }));
    expect(parsed.memberIds).toEqual([MEMBER_A.id, MEMBER_B.id]);
  });

  it("removes duplicate member ids", () => {
    const config = readConfig(
      envWith({ ALLOWED_USER_IDS: JSON.stringify([MEMBER_A.id, MEMBER_A.id, `${MEMBER_A.id}`, MEMBER_B.id]) }),
    );
    expect(config.memberIds).toEqual([MEMBER_A.id, MEMBER_B.id]);
  });

  it("accepts a single member", () => {
    const config = readConfig(envWith({ ALLOWED_USER_IDS: JSON.stringify([MEMBER_A.id]) }));
    expect(config.memberIds).toEqual([MEMBER_A.id]);
  });

  it("accepts another timezone name that the runtime accepts", () => {
    expect(readConfig(envWith({ HOUSEHOLD_TZ: "Europe/Berlin" })).timezone).toBe("Europe/Berlin");
  });
});

describe("readConfig with invalid settings", () => {
  it.each([
    ["missing", undefined],
    ["empty text", ""],
    ["an empty list", "[]"],
    ["an empty parsed list", []],
    ["not JSON", "1001,1002"],
    ["a JSON object", "{}"],
    ["a single number", "1001"],
    ["a negative number", JSON.stringify([MEMBER_A.id, -5])],
    ["zero", JSON.stringify([0])],
    ["a fraction", JSON.stringify([MEMBER_A.id, 10.5])],
    ["a word", JSON.stringify([MEMBER_A.id, "ben"])],
    ["a string with a minus sign", JSON.stringify(["-1001"])],
    ["a string with a fraction", JSON.stringify(["1001.5"])],
    ["an empty string", JSON.stringify([""])],
    ["null", JSON.stringify([null])],
  ])("rejects a member list that is %s", (_label, value) => {
    expectInvalid("ALLOWED_USER_IDS", value);
  });

  it.each([
    ["missing", undefined],
    ["empty text", ""],
    ["not valid JSON", "{not json"],
    ["without an id", JSON.stringify({ ...BOT_INFO, id: undefined })],
    ["with an id that is not a number", JSON.stringify({ ...BOT_INFO, id: "424242" })],
    ["without a username", JSON.stringify({ ...BOT_INFO, username: undefined })],
    ["a JSON array", "[]"],
  ])("rejects a bot identity that is %s", (_label, value) => {
    expectInvalid("BOT_INFO", value);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a name the runtime does not accept", "Mars/Olympus"],
  ])("rejects a timezone that is %s", (_label, value) => {
    expectInvalid("HOUSEHOLD_TZ", value);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("rejects a bot token that is %s", (_label, value) => {
    expectInvalid("BOT_TOKEN", value);
  });
});
