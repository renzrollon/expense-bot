import { describe, expect, it } from "vitest";
import { secretMatches, type Compare } from "../../src/gateway/secret";
import { WEBHOOK_SECRET } from "../helpers/constants";

interface Recorder {
  compare: Compare;
  calls: [Uint8Array, Uint8Array][];
}

/** A compare function that records its arguments and compares the bytes in full. */
function recorder(): Recorder {
  const calls: [Uint8Array, Uint8Array][] = [];
  const compare: Compare = (a, b) => {
    calls.push([a, b]);
    if (a.byteLength !== b.byteLength) throw new Error("compared values of different lengths");
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
  };
  return { compare, calls };
}

function sameLengthWrong(secret: string): string {
  const last = secret.at(-1) === "x" ? "y" : "x";
  return `${secret.slice(0, -1)}${last}`;
}

describe("secretMatches", () => {
  it("accepts the configured secret with the default comparison", () => {
    expect(secretMatches(WEBHOOK_SECRET, WEBHOOK_SECRET)).toBe(true);
  });

  it("rejects a secret with the right length and the wrong content", () => {
    const wrong = sameLengthWrong(WEBHOOK_SECRET);
    expect(wrong).toHaveLength(WEBHOOK_SECRET.length);
    expect(secretMatches(wrong, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a shorter and a longer secret", () => {
    expect(secretMatches(WEBHOOK_SECRET.slice(0, -1), WEBHOOK_SECRET)).toBe(false);
    expect(secretMatches(`${WEBHOOK_SECRET}x`, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a missing or empty received secret", () => {
    expect(secretMatches(null, WEBHOOK_SECRET)).toBe(false);
    expect(secretMatches("", WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects every secret when none is configured", () => {
    expect(secretMatches(WEBHOOK_SECRET, undefined)).toBe(false);
    expect(secretMatches(null, undefined)).toBe(false);
    expect(secretMatches(WEBHOOK_SECRET, "")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches(null, "")).toBe(false);
  });

  it("Comparison runs in full for wrong content", () => {
    const { compare, calls } = recorder();
    expect(secretMatches(sameLengthWrong(WEBHOOK_SECRET), WEBHOOK_SECRET, compare)).toBe(false);
    expect(calls).toHaveLength(1);
    const [a, b] = calls[0]!;
    expect(a).toBeInstanceOf(Uint8Array);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(a.byteLength).toBe(b.byteLength);
  });

  it.each([
    ["shorter", WEBHOOK_SECRET.slice(0, 3)],
    ["longer", `${WEBHOOK_SECRET}-and-more`],
  ])("Comparison is not skipped for a different length (%s)", (_label, received) => {
    const { compare, calls } = recorder();
    expect(secretMatches(received, WEBHOOK_SECRET, compare)).toBe(false);
    expect(calls).toHaveLength(1);
    const [a, b] = calls[0]!;
    expect(a).toBeInstanceOf(Uint8Array);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(a.byteLength).toBe(b.byteLength);
  });

  it("makes exactly one comparison for the right secret", () => {
    const { compare, calls } = recorder();
    expect(secretMatches(WEBHOOK_SECRET, WEBHOOK_SECRET, compare)).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
