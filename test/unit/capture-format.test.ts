import { describe, expect, it } from "vitest";
import { categoryLabel, dateLabel, formatPesos, rejectionText, shorten } from "../../src/capture/format";
import type { RejectionReason } from "../../src/parser";

const SIXTY = "a".repeat(60);
const SIXTY_ONE = "b".repeat(61);
const EMOJI_SIXTY_ONE = `🍔${"c".repeat(60)}`;

describe("formatPesos", () => {
  it.each([
    { centavos: 5, text: "₱0.05" },
    { centavos: 25000, text: "₱250" },
    { centavos: 150050, text: "₱1,500.50" },
    { centavos: 252000, text: "₱2,520" },
    { centavos: 100000000, text: "₱1,000,000" },
    { centavos: 999999999, text: "₱9,999,999.99" },
  ])("$centavos centavos is $text", ({ centavos, text }) => {
    expect(formatPesos(centavos)).toBe(text);
  });
});

describe("dateLabel", () => {
  it.each([
    { label: "today", spentOn: "2026-09-29", sentOn: "2026-09-29", text: "today" },
    { label: "yesterday", spentOn: "2026-09-28", sentOn: "2026-09-29", text: "yesterday" },
    { label: "the same year", spentOn: "2026-09-27", sentOn: "2026-09-29", text: "Sep 27" },
    { label: "the same year, a one-digit day", spentOn: "2026-03-05", sentOn: "2026-09-29", text: "Mar 5" },
    { label: "the previous year", spentOn: "2026-12-30", sentOn: "2027-01-02", text: "Dec 30, 2026" },
    { label: "yesterday across a month end", spentOn: "2026-09-30", sentOn: "2026-10-01", text: "yesterday" },
    { label: "yesterday across a year end", spentOn: "2026-12-31", sentOn: "2027-01-01", text: "yesterday" },
    { label: "two days back across a month end", spentOn: "2026-09-30", sentOn: "2026-10-02", text: "Sep 30" },
  ])("$label", ({ spentOn, sentOn, text }) => {
    expect(dateLabel(spentOn, sentOn)).toBe(text);
  });
});

describe("categoryLabel", () => {
  it.each([
    { label: "a known id", id: "dining", text: "🍽 Dining" },
    { label: "an unknown id", id: "snacks", text: "snacks" },
  ])("$label", ({ id, text }) => {
    expect(categoryLabel(id)).toBe(text);
  });
});

describe("shorten", () => {
  it.each([
    { label: "60 characters stay whole", description: SIXTY, text: SIXTY },
    { label: "61 characters are cut to 59 and an ellipsis", description: SIXTY_ONE, text: `${"b".repeat(59)}…` },
    { label: "61 code points with an emoji", description: EMOJI_SIXTY_ONE, text: `🍔${"c".repeat(58)}…` },
    { label: "an empty description", description: "", text: "" },
  ])("$label", ({ description, text }) => {
    expect(shorten(description)).toBe(text);
  });
});

describe("rejectionText", () => {
  it.each<{ reason: RejectionReason; text: string }>([
    { reason: "multiple_dates", text: "❌ Not logged: use one date per message." },
    { reason: "invalid_date", text: "❌ Not logged: that date does not exist." },
    { reason: "future_date", text: "❌ Not logged: the date is in the future." },
    {
      reason: "amount_out_of_range",
      text: "❌ Not logged: an amount must be more than ₱0 and less than ₱10,000,000.",
    },
    {
      reason: "too_many_items",
      text: "❌ Not logged: 10 items per message at most. Send the rest in another message.",
    },
  ])("$reason", ({ reason, text }) => {
    expect(rejectionText(reason)).toBe(text);
  });
});
