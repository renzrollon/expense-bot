import { describe, expect, it } from "vitest";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { BEN, button, CONFIRMATION, ENTRY, MESSAGE, useCorrectionsHarness } from "./helpers/ledger-fixtures";

const NOTICE = "✏️ Edit not applied. Undo and resend.";

const h = useCorrectionsHarness();

describe("The system SHALL mark the confirmation when a logged message is edited", () => {
  it("Happy path — a logged message is edited", async () => {
    await h.seedPreamble();

    const response = await h.edit(MESSAGE.lunch, "lunch 300");

    expect(response.status).toBe(200);
    const entry = await h.entry(ENTRY.lunch);
    expect(entry).toMatchObject({ amount_centavos: 25000, raw_text: "lunch 250", category_id: "dining" });
    expect(entry.source_edited_at).toBe(h.now.toISOString());
    expect(h.textEdits()).toEqual([
      {
        chat_id: ALLOWED_CHAT_ID,
        message_id: CONFIRMATION.lunch,
        text: ["✅ ₱250 · 🍽 Dining · Ana · today", NOTICE].join("\n"),
        reply_markup: {
          inline_keyboard: [[button("Category", `c:${ENTRY.lunch}`), button("Undo", `u:${ENTRY.lunch}`)]],
        },
        link_preview_options: { is_disabled: true },
      },
    ]);
    expect(h.sent()).toEqual([]);
  });

  it("Failure — a message that was never logged", async () => {
    await h.seedPreamble();
    const before = await h.entries();

    const response = await h.edit(50, "lunch 250");

    expect(response.status).toBe(200);
    expect(await h.entries()).toEqual(before);
    expect(h.telegram.calls).toEqual([]);
  });

  it("Edge case — a second edit", async () => {
    await h.seedPreamble();
    await h.edit(MESSAGE.lunch, "lunch 300");
    const firstEdit = (await h.entry(ENTRY.lunch)).source_edited_at;
    h.now = new Date(h.now.getTime() + 60_000);

    const response = await h.edit(MESSAGE.lunch, "lunch 350");

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.lunch)).source_edited_at).toBe(firstEdit);
    const text = h.lastText(CONFIRMATION.lunch) ?? "";
    expect(text.split(NOTICE)).toHaveLength(2);
    expect(text).toBe(["✅ ₱250 · 🍽 Dining · Ana · today", NOTICE].join("\n"));
    expect(h.sent()).toEqual([]);
  });

  it("Edge case — the notice stays after a later correction", async () => {
    await h.seedPreamble();
    await h.edit(MESSAGE.lunch, "lunch 300");

    const response = await h.press(`s:${ENTRY.lunch}:gifts`, { messageId: CONFIRMATION.lunch, from: BEN });

    expect(response.status).toBe(200);
    expect(h.lastText(CONFIRMATION.lunch)).toBe(["✅ ₱250 · 🎁 Gifts · Ana · today", NOTICE].join("\n"));
  });

  it("Edge case — the entries are all removed", async () => {
    await h.seedPreamble();
    await h.edit(MESSAGE.lunch, "lunch 300");

    const response = await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });

    expect(response.status).toBe(200);
    expect(h.lastText(CONFIRMATION.lunch)).toBe("🗑 removed · ₱250 · 🍽 Dining · Ana · today");
  });

  it("Edge case — the text did not change", async () => {
    await h.seedPreamble();

    const response = await h.edit(MESSAGE.lunch, "lunch 250");

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.lunch)).source_edited_at).toBeNull();
    expect(h.textEdits()).toEqual([]);
    expect(h.telegram.calls).toEqual([]);
  });

  it("Edge case — every entry of a message is marked", async () => {
    await h.seedPreamble();

    const response = await h.edit(MESSAGE.multi, "grab 200, groceries 2340 gcash");

    expect(response.status).toBe(200);
    const grab = await h.entry(ENTRY.grab);
    const groceries = await h.entry(ENTRY.groceries);
    expect(grab.source_edited_at).toBe(h.now.toISOString());
    expect(groceries.source_edited_at).toBe(h.now.toISOString());
    expect(h.lastText(CONFIRMATION.multi)?.split("\n").at(-1)).toBe(NOTICE);
  });
});
