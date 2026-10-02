import { DEFAULT_NUDGE_HOUR } from "../config/schedule";
import { RegistrationError } from "../gateway/registry";

/** The nudge settings, read once when the Worker starts (design Decision 14). */
export interface NudgeSettings {
  enabled: boolean;
  hour: number;
}

/**
 * Reads `NUDGE_ENABLED` and `NUDGE_HOUR` from the Worker's settings. Pure. A value
 * that is present but not accepted throws `RegistrationError` naming the setting,
 * so a bad value fails the deploy.
 */
export function readNudgeSettings(env: Readonly<Record<string, unknown>>): NudgeSettings {
  return { enabled: readEnabled(env.NUDGE_ENABLED), hour: readHour(env.NUDGE_HOUR) };
}

/** `true` or `false`, as a boolean or as that text; `true` when absent. */
function readEnabled(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new RegistrationError(`NUDGE_ENABLED must be true or false, got ${JSON.stringify(value)}`);
}

/** A whole number from 0 to 23, as a number or as text made of digits; the default hour when absent. */
function readHour(value: unknown): number {
  if (value === undefined) return DEFAULT_NUDGE_HOUR;
  const hour =
    typeof value === "number" ? value : typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
  throw new RegistrationError(`NUDGE_HOUR must be a whole number from 0 to 23, got ${JSON.stringify(value)}`);
}
