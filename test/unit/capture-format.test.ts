import { describe, expect, it } from "vitest";
import { categoryLabel, confirmationText, dateLabel, formatPesos, rejectionText } from "../../src/capture/format";
import type { Entry } from "../../src/ledger";
import type { RejectionReason } from "../../src/parser";

const SENT_ON = "2026-09-29";
const NOW = "2026-09-29T10:00:00.000Z";

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 1,
    chatId: -1001,
    sourceMessageId: 10,
    itemIndex: 0,
    confirmationMessageId: null,
    payerUserId: 1001,
    amountCentavos: 25000,
    currency: "PHP",
    description: "lunch",
    categoryId: "dining",
    categorySource: "keyword",
    spentOn: SENT_ON,
    rawText: "lunch 250",
    parser: "rules",
    checkAmount: false,
    createdAt: NOW,
    createdBy: 1001,
    updatedAt: NOW,
    updatedBy: 1001,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

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

describe("confirmationText", () => {
  it.each<{ label: string; entries: Entry[]; lines: string[]; sentOn?: string }>([
    {
      label: "one entry",
      entries: [entry()],
      lines: ["✅ ₱250 · 🍽 Dining · Ana · today"],
    },
    {
      label: "two entries",
      entries: [
        entry({ id: 1, itemIndex: 0, amountCentavos: 18000, description: "grab", categoryId: "transport" }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 234000, description: "groceries gcash", categoryId: "groceries" }),
      ],
      lines: [
        "✅ 2 entries · ₱2,520 · Ana · today",
        "1. ₱180 · 🚗 Transport · grab",
        "2. ₱2,340 · 🛒 Groceries · groceries gcash",
      ],
    },
    {
      label: "a flagged entry, one line",
      entries: [entry({ amountCentavos: 60000, description: "dinner for 2", checkAmount: true })],
      lines: ["✅ ₱600 · 🍽 Dining · Ana · today · ⚠️ check amount"],
    },
    {
      label: "a flagged entry, several lines",
      entries: [
        entry({ id: 1, itemIndex: 0, amountCentavos: 60000, description: "dinner for 2", checkAmount: true }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 8000, description: "coffee" }),
      ],
      lines: [
        "✅ 2 entries · ₱680 · Ana · today",
        "1. ₱600 · 🍽 Dining · dinner for 2 · ⚠️ check amount",
        "2. ₱80 · 🍽 Dining · coffee",
      ],
    },
    {
      label: "an empty description",
      entries: [
        entry({ id: 1, itemIndex: 0, amountCentavos: 25000, description: "", categoryId: "other", categorySource: "default" }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 8000, description: "coffee" }),
      ],
      lines: ["✅ 2 entries · ₱330 · Ana · today", "1. ₱250 · ❓ Other", "2. ₱80 · 🍽 Dining · coffee"],
    },
    {
      label: "an empty description and a flag",
      entries: [
        entry({ id: 1, itemIndex: 0, amountCentavos: 25000, description: "", categoryId: "other", checkAmount: true }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 8000, description: "coffee" }),
      ],
      lines: [
        "✅ 2 entries · ₱330 · Ana · today",
        "1. ₱250 · ❓ Other · ⚠️ check amount",
        "2. ₱80 · 🍽 Dining · coffee",
      ],
    },
    {
      label: "an unknown category id",
      entries: [entry({ amountCentavos: 15000, description: "acai", categoryId: "snacks", categorySource: "manual" })],
      lines: ["✅ ₱150 · snacks · Ana · today"],
    },
    {
      label: "descriptions of 60 and 61 characters",
      entries: [
        entry({ id: 1, itemIndex: 0, amountCentavos: 100, description: SIXTY }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 200, description: SIXTY_ONE }),
      ],
      lines: [
        "✅ 2 entries · ₱3 · Ana · today",
        `1. ₱1 · 🍽 Dining · ${SIXTY}`,
        `2. ₱2 · 🍽 Dining · ${"b".repeat(59)}…`,
      ],
    },
    {
      label: "a description of 61 code points with an emoji",
      entries: [
        entry({ id: 1, itemIndex: 0, amountCentavos: 100, description: EMOJI_SIXTY_ONE }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 200, description: "coffee" }),
      ],
      lines: [
        "✅ 2 entries · ₱3 · Ana · today",
        `1. ₱1 · 🍽 Dining · 🍔${"c".repeat(58)}…`,
        "2. ₱2 · 🍽 Dining · coffee",
      ],
    },
    {
      label: "the first entry's date",
      entries: [
        entry({ id: 1, itemIndex: 0, spentOn: "2026-09-28" }),
        entry({ id: 2, itemIndex: 1, amountCentavos: 8000, description: "coffee", spentOn: "2026-09-28" }),
      ],
      lines: ["✅ 2 entries · ₱330 · Ana · yesterday", "1. ₱250 · 🍽 Dining · lunch", "2. ₱80 · 🍽 Dining · coffee"],
    },
    {
      label: "an earlier year",
      entries: [entry({ amountCentavos: 50000, description: "gift", categoryId: "gifts", spentOn: "2026-12-30" })],
      lines: ["✅ ₱500 · 🎁 Gifts · Ana · Dec 30, 2026"],
      sentOn: "2027-01-02",
    },
  ])("$label", ({ entries, lines, sentOn }) => {
    expect(confirmationText(entries, "Ana", sentOn ?? SENT_ON)).toBe(lines.join("\n"));
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
