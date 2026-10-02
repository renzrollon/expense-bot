import { describe, expect, it } from "vitest";
import { parsePress } from "../../src/corrections/data";

// The gateway splits button data at the first colon: `u:7` reaches the handler as kind `u`, payload `7`.
describe("The system SHALL ignore button data it cannot use", () => {
  it.each([
    ["c", "7", { kind: "c", entryId: 7 }],
    ["s", "12:dining", { kind: "s", entryId: 12, categoryId: "dining" }],
    ["u", "7", { kind: "u", entryId: 7 }],
    ["r", "7", { kind: "r", entryId: 7 }],
    ["b", "12", { kind: "b", entryId: 12 }],
  ] as const)("valid data — %s:%s", (kind, payload, press) => {
    expect(parsePress(kind, payload)).toEqual(press);
  });

  it("Happy path — an entry the ledger does not hold: u:424242 still parses", () => {
    expect(parsePress("u", "424242")).toEqual({ kind: "u", entryId: 424242 });
  });

  it.each([
    ["u", ""], // u:
    ["u", "abc"], // u:abc
    ["u", "7:extra"], // u:7:extra
    ["s", "7"], // s:7
    ["s", "7:"], // s:7:
    ["c", "-7"], // c:-7
  ] as const)("Failure — malformed data: %s:%s", (kind, payload) => {
    expect(parsePress(kind, payload)).toBeNull();
  });

  it.each([
    ["u", "07"], // u:07
    ["u", " 7"], // u: 7
    ["u", "7.0"], // u:7.0
    ["u", "+7"], // u:+7
  ] as const)("Edge case — an id that looks like 7 but is not written as one: %s:%s", (kind, payload) => {
    expect(parsePress(kind, payload)).toBeNull();
  });

  it("Failure — a category that is not in the list: s:12:snacks", () => {
    expect(parsePress("s", "12:snacks")).toBeNull();
  });

  it.each([
    ["u", "0"],
    ["u", "7 "],
    ["s", "12:dining:extra"],
    ["s", "12: dining"],
    ["u", "99999999999999999"], // 17 digits
    ["u", "9999999999999999"], // 16 digits, beyond a safe integer
  ] as const)("other unusable data: %s:%s", (kind, payload) => {
    expect(parsePress(kind, payload)).toBeNull();
  });
});
