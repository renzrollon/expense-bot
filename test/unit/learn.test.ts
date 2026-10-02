import { describe, expect, it } from "vitest";
import { learnableKeyword } from "../../src/categories";

describe("Which descriptions are learned", () => {
  it.each([
    ["Acai", "acai"],
    ["Milk Tea", "milk tea"],
  ])("Happy path — a short description: %j", (description, keyword) => {
    expect(learnableKeyword(description)).toBe(keyword);
  });

  it.each(["", "!!", "lunch with ana at jollibee"])("Failure — a description that cannot be learned: %j", (description) => {
    expect(learnableKeyword(description)).toBeNull();
  });

  it("Edge case — exactly 3 words, and 4", () => {
    expect(learnableKeyword("dinner for 2")).toBe("dinner for 2");
    expect(learnableKeyword("dinner for 2 people")).toBeNull();
  });

  it("Edge case — only words count", () => {
    expect(learnableKeyword("🍔 Burger!!")).toBe("burger");
  });

  it("Edge case — two spellings of one description", () => {
    expect(learnableKeyword("Açaí  BOWL")).toBe("acai bowl");
    expect(learnableKeyword("acai bowl")).toBe("acai bowl");
  });
});
