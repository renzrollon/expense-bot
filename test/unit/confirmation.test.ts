import { describe, expect, it } from "vitest";
import { categoryGrid, renderConfirmation } from "../../src/capture/confirmation";
import type { Entry } from "../../src/ledger";

const TIMEZONE = "Asia/Manila";
/** Stored a few seconds after 10:00 on Tuesday 2026-09-29 in Manila. */
const CREATED = "2026-09-29T02:00:03.000Z";
const REMOVED_AT = "2026-09-29T02:05:00.000Z";
const EDITED_AT = "2026-09-29T02:06:00.000Z";
const EDIT_NOTICE = "✏️ Edit not applied. Undo and resend.";

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 7,
    chatId: -1001,
    sourceMessageId: 41,
    itemIndex: 0,
    confirmationMessageId: 900,
    payerUserId: 1001,
    amountCentavos: 25000,
    currency: "PHP",
    description: "lunch",
    categoryId: "dining",
    categorySource: "keyword",
    spentOn: "2026-09-29",
    rawText: "lunch 250",
    parser: "rules",
    checkAmount: false,
    createdAt: CREATED,
    createdBy: 1001,
    updatedAt: CREATED,
    updatedBy: 1001,
    deletedAt: null,
    deletedBy: null,
    sourceEditedAt: null,
    ...overrides,
  };
}

const removed = { deletedAt: REMOVED_AT, deletedBy: 1001 } satisfies Partial<Entry>;

/** Entries 8 and 9 of Ana's `grab 180, groceries 2340 gcash`. */
function grabAndGroceries(first: Partial<Entry> = {}, second: Partial<Entry> = {}): Entry[] {
  const message = { sourceMessageId: 42, rawText: "grab 180, groceries 2340 gcash", confirmationMessageId: 901 };
  return [
    entry({ ...message, id: 8, itemIndex: 0, amountCentavos: 18000, description: "grab", categoryId: "transport", ...first }),
    entry({
      ...message,
      id: 9,
      itemIndex: 1,
      amountCentavos: 234000,
      description: "groceries gcash",
      categoryId: "groceries",
      ...second,
    }),
  ];
}

function button(text: string, data: string) {
  return { text, callback_data: data };
}

describe("The confirmation shows the current state of its entries", () => {
  it("Happy path — one active entry has two buttons", () => {
    const view = renderConfirmation([entry()], "Ana", TIMEZONE);

    expect(view.text).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
    expect(view.keyboard).toEqual([[button("Category", "c:7"), button("Undo", "u:7")]]);
  });

  it("Happy path — several entries each have a numbered row", () => {
    const view = renderConfirmation(grabAndGroceries(), "Ana", TIMEZONE);

    expect(view.keyboard).toEqual([
      [button("1 · Category", "c:8"), button("1 · Undo", "u:8")],
      [button("2 · Category", "c:9"), button("2 · Undo", "u:9")],
    ]);
  });

  it("Failure — the payer has no member record", () => {
    // payerName() gives the user id as text when the member records hold no such member.
    const view = renderConfirmation([entry()], "1001", TIMEZONE);

    expect(view.text).toBe("✅ ₱250 · 🍽 Dining · 1001 · today");
    expect(view.keyboard).toEqual([[button("Category", "c:7"), button("Undo", "u:7")]]);
  });

  it("Edge case — one removed entry", () => {
    const view = renderConfirmation([entry(removed)], "Ana", TIMEZONE);

    expect(view.text).toBe("🗑 removed · ₱250 · 🍽 Dining · Ana · today");
    expect(view.keyboard).toEqual([[button("Restore", "r:7")]]);
  });

  it("Edge case — one of several entries is removed", () => {
    const view = renderConfirmation(grabAndGroceries(removed), "Ana", TIMEZONE);

    expect(view.text).toBe(
      [
        "✅ 1 of 2 entries · ₱2,340 · Ana · today",
        "1. 🗑 removed · ₱180 · 🚗 Transport · grab",
        "2. ₱2,340 · 🛒 Groceries · groceries gcash",
      ].join("\n"),
    );
    expect(view.keyboard).toEqual([
      [button("1 · Restore", "r:8")],
      [button("2 · Category", "c:9"), button("2 · Undo", "u:9")],
    ]);
  });

  it("Edge case — every entry is removed", () => {
    const view = renderConfirmation(grabAndGroceries(removed, removed), "Ana", TIMEZONE);

    expect(view.text).toBe(
      [
        "🗑 0 of 2 entries · ₱0 · Ana · today",
        "1. 🗑 removed · ₱180 · 🚗 Transport · grab",
        "2. 🗑 removed · ₱2,340 · 🛒 Groceries · groceries gcash",
      ].join("\n"),
    );
    expect(view.keyboard).toEqual([[button("1 · Restore", "r:8")], [button("2 · Restore", "r:9")]]);
  });

  it("Edge case — a removed entry loses the amount check", () => {
    const flagged = { amountCentavos: 60000, description: "dinner for 2", rawText: "dinner for 2 600", checkAmount: true };

    expect(renderConfirmation([entry(flagged)], "Ana", TIMEZONE).text).toBe(
      "✅ ₱600 · 🍽 Dining · Ana · today · ⚠️ check amount",
    );
    expect(renderConfirmation([entry({ ...flagged, ...removed })], "Ana", TIMEZONE).text).toBe(
      "🗑 removed · ₱600 · 🍽 Dining · Ana · today",
    );
  });

  it("Edge case — a removed entry of several loses the amount check", () => {
    const view = renderConfirmation(
      grabAndGroceries({ ...removed, checkAmount: true }, { checkAmount: true }),
      "Ana",
      TIMEZONE,
    );

    expect(view.text).toBe(
      [
        "✅ 1 of 2 entries · ₱2,340 · Ana · today",
        "1. 🗑 removed · ₱180 · 🚗 Transport · grab",
        "2. ₱2,340 · 🛒 Groceries · groceries gcash · ⚠️ check amount",
      ].join("\n"),
    );
  });

  it("Edge case — the edit notice is shown only while an entry is active", () => {
    const edited = { sourceEditedAt: EDITED_AT };

    const active = renderConfirmation(grabAndGroceries({ ...edited, ...removed }, edited), "Ana", TIMEZONE);
    expect(active.text.split("\n")).toEqual([
      "✅ 1 of 2 entries · ₱2,340 · Ana · today",
      "1. 🗑 removed · ₱180 · 🚗 Transport · grab",
      "2. ₱2,340 · 🛒 Groceries · groceries gcash",
      EDIT_NOTICE,
    ]);

    const allActive = renderConfirmation(grabAndGroceries(edited, edited), "Ana", TIMEZONE);
    expect(allActive.text.split("\n").at(-1)).toBe(EDIT_NOTICE);
    expect(allActive.text.split("\n")[0]).toBe("✅ 2 entries · ₱2,520 · Ana · today");

    const none = renderConfirmation(
      grabAndGroceries({ ...edited, ...removed }, { ...edited, ...removed }),
      "Ana",
      TIMEZONE,
    );
    expect(none.text).not.toContain("✏️");
    expect(none.text.split("\n")).toHaveLength(3);
  });

  it("Edge case — the edit notice on a one-entry message", () => {
    const edited = { sourceEditedAt: EDITED_AT };

    expect(renderConfirmation([entry(edited)], "Ana", TIMEZONE).text).toBe(
      ["✅ ₱250 · 🍽 Dining · Ana · today", EDIT_NOTICE].join("\n"),
    );
    expect(renderConfirmation([entry({ ...edited, ...removed })], "Ana", TIMEZONE).text).toBe(
      "🗑 removed · ₱250 · 🍽 Dining · Ana · today",
    );
  });

  it("Edge case — the date word does not change with the day of the edit", () => {
    // Entry 7 is changed on 2026-10-02. The renderer reads no clock, only the creation time.
    const view = renderConfirmation(
      [entry({ updatedAt: "2026-10-02T03:00:00.000Z", updatedBy: 1002, categorySource: "manual" })],
      "Ana",
      TIMEZONE,
    );

    expect(view.text).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
  });

  it("The date word is relative to the local date the first entry was stored", () => {
    // Sent at 23:59 on 2026-09-29 in Manila, stored at 00:00:05 on 2026-09-30.
    const view = renderConfirmation([entry({ createdAt: "2026-09-29T16:00:05.000Z" })], "Ana", TIMEZONE);

    expect(view.text).toBe("✅ ₱250 · 🍽 Dining · Ana · yesterday");
  });

  it("No entries render nothing", () => {
    expect(renderConfirmation([], "Ana", TIMEZONE)).toEqual({ text: "", keyboard: [] });
  });
});

const SIXTY = "a".repeat(60);
const SIXTY_ONE = "b".repeat(61);
const EMOJI_SIXTY_ONE = `🍔${"c".repeat(60)}`;

describe("renderConfirmation text of active entries", () => {
  it.each<{ label: string; entries: Entry[]; lines: string[] }>([
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
      entries: [
        entry({
          amountCentavos: 50000,
          description: "gift",
          categoryId: "gifts",
          spentOn: "2026-12-30",
          createdAt: "2027-01-02T02:00:03.000Z",
        }),
      ],
      lines: ["✅ ₱500 · 🎁 Gifts · Ana · Dec 30, 2026"],
    },
  ])("$label", ({ entries, lines }) => {
    expect(renderConfirmation(entries, "Ana", TIMEZONE).text).toBe(lines.join("\n"));
  });
});

describe("categoryGrid", () => {
  it("Happy path — the grid opens", () => {
    const s = (label: string, id: string) => button(label, `s:12:${id}`);

    expect(categoryGrid(12)).toEqual([
      [s("🛒 Groceries", "groceries"), s("🍽 Dining", "dining"), s("🚗 Transport", "transport")],
      [s("💡 Bills", "bills"), s("🏠 Housing", "housing"), s("🧹 Household", "household")],
      [s("💊 Health", "health"), s("🎒 Kids", "kids"), s("🤝 Family", "family")],
      [s("🎁 Gifts", "gifts"), s("🛍 Personal", "personal"), s("🎬 Fun", "fun")],
      [s("❓ Other", "other"), s("🔁 Transfers", "transfer")],
      [button("Back", "b:12")],
    ]);
  });

  it("Every button's data fits in 64 bytes", () => {
    const largest = Number.MAX_SAFE_INTEGER;
    for (const row of categoryGrid(largest)) {
      for (const cell of row) {
        expect("callback_data" in cell).toBe(true);
        if ("callback_data" in cell) expect(new TextEncoder().encode(cell.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });
});
