import { describe, expect, it } from "vitest";
import { resolveUnclaimed, type UpdateRecord } from "../../src/gateway/update-log";

const NOW = new Date("2026-09-29T10:05:30.123Z");

/** The claimed_at text of an attempt that started `ms` milliseconds before NOW. */
function startedAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function record(status: string, attempts: number, claimedAgoMs = 1_000): UpdateRecord {
  return { status, attempts, claimedAt: startedAgo(claimedAgoMs) };
}

describe("resolveUnclaimed (design Decision 6 table)", () => {
  it.each([1, 2, 3])("a done record with %i attempts is finished", (attempts) => {
    expect(resolveUnclaimed(record("done", attempts), NOW)).toBe("finished");
  });

  it("a parked record is finished", () => {
    expect(resolveUnclaimed(record("parked", 3), NOW)).toBe("finished");
    expect(resolveUnclaimed(record("parked", 3, 600_000), NOW)).toBe("finished");
  });

  it.each([
    [1, 1_000],
    [2, 119_999],
    [3, 60_000],
  ])("a processing record with %i attempts and a held lease is in progress", (attempts, ago) => {
    expect(resolveUnclaimed(record("processing", attempts, ago), NOW)).toBe("in_progress");
  });

  it("a processing record whose attempt started exactly 120 seconds ago is in progress", () => {
    expect(resolveUnclaimed(record("processing", 3, 120_000), NOW)).toBe("in_progress");
    expect(resolveUnclaimed(record("processing", 1, 120_000), NOW)).toBe("in_progress");
  });

  it("a processing record with an expired lease and 3 attempts used is exhausted", () => {
    expect(resolveUnclaimed(record("processing", 3, 120_001), NOW)).toBe("exhausted");
    expect(resolveUnclaimed(record("processing", 3, 3_600_000), NOW)).toBe("exhausted");
  });

  it("a failed record with 3 attempts used is exhausted", () => {
    expect(resolveUnclaimed(record("failed", 3), NOW)).toBe("exhausted");
    expect(resolveUnclaimed(record("failed", 3, 600_000), NOW)).toBe("exhausted");
  });

  it("Record changed between the claim and the read", () => {
    expect(resolveUnclaimed(record("failed", 1), NOW)).toBe("in_progress");
    expect(resolveUnclaimed(record("failed", 2), NOW)).toBe("in_progress");
    expect(resolveUnclaimed(null, NOW)).toBe("in_progress");
  });

  it("a processing record with an expired lease and fewer than 3 attempts is in progress", () => {
    expect(resolveUnclaimed(record("processing", 1, 120_001), NOW)).toBe("in_progress");
    expect(resolveUnclaimed(record("processing", 2, 600_000), NOW)).toBe("in_progress");
  });

  it("a record in a state that no other row names is in progress", () => {
    expect(resolveUnclaimed(record("unknown", 1), NOW)).toBe("in_progress");
    expect(resolveUnclaimed(record("", 3, 600_000), NOW)).toBe("in_progress");
  });
});
