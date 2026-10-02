import { describe, expect, it } from "vitest";
import { RegistrationError } from "../../src/gateway/registry";
import { readNudgeSettings } from "../../src/nudge/settings";

function refusal(env: Record<string, unknown>): RegistrationError {
  try {
    readNudgeSettings(env);
  } catch (error) {
    expect(error).toBeInstanceOf(RegistrationError);
    return error as RegistrationError;
  }
  throw new Error("expected readNudgeSettings to throw");
}

describe("The system SHALL read the nudge settings when it starts", () => {
  it("Happy path — the defaults", () => {
    expect(readNudgeSettings({})).toEqual({ enabled: true, hour: 21 });
  });

  it("Happy path — another hour", () => {
    expect(readNudgeSettings({ NUDGE_HOUR: "20" })).toEqual({ enabled: true, hour: 20 });
  });

  it.each([["24"], ["-1"], ["9.5"], ["evening"], [""], [24], [-1], [9.5], [null]])(
    "Failure — a setting that is not valid: NUDGE_HOUR %j",
    (value) => {
      const error = refusal({ NUDGE_HOUR: value });
      expect(error.message).toContain("NUDGE_HOUR");
      expect(error.message).not.toContain("NUDGE_ENABLED");
    },
  );

  it.each([["maybe"], ["1"], [""], [1], [null]])("Failure — a setting that is not valid: NUDGE_ENABLED %j", (value) => {
    const error = refusal({ NUDGE_ENABLED: value });
    expect(error.message).toContain("NUDGE_ENABLED");
    expect(error.message).not.toContain("NUDGE_HOUR");
  });

  it.each([
    ["0", 0],
    ["23", 23],
    [7, 7],
    ["07", 7],
  ] as const)("Edge case — the limits and both forms: NUDGE_HOUR %j", (value, hour) => {
    expect(readNudgeSettings({ NUDGE_HOUR: value })).toEqual({ enabled: true, hour });
  });

  it.each([
    ["false", false],
    [false, false],
    ["true", true],
    [true, true],
  ] as const)("Edge case — the nudge is disabled, or enabled: NUDGE_ENABLED %j", (value, enabled) => {
    expect(readNudgeSettings({ NUDGE_ENABLED: value })).toEqual({ enabled, hour: 21 });
  });

  it("a disabled nudge still refuses a bad hour", () => {
    expect(refusal({ NUDGE_ENABLED: "false", NUDGE_HOUR: "24" }).message).toContain("NUDGE_HOUR");
  });

  it("unrelated settings are ignored", () => {
    expect(readNudgeSettings({ TIMEZONE: "Asia/Manila", NUDGE_ENABLED: "true", NUDGE_HOUR: "21" })).toEqual({
      enabled: true,
      hour: 21,
    });
  });
});
