import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { totalsByCategory } from "../src/ledger";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { BEN, button, CONFIRMATION, ENTRY, MESSAGE, useCorrectionsHarness } from "./helpers/ledger-fixtures";

const STALE = "This button no longer works.";
const TODAY = { from: "2026-09-29", to: "2026-09-29" };

const NOT_MODIFIED = {
  error_code: 400,
  description:
    "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
};

const h = useCorrectionsHarness();

async function dining(): Promise<number | undefined> {
  return (await totalsByCategory(env.DB, TODAY)).find((total) => total.categoryId === "dining")?.totalCentavos;
}

describe("The system SHALL remove an entry when Undo is pressed", () => {
  it("Happy path — Undo removes the entry", async () => {
    await h.seedPreamble();

    const response = await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });

    expect(response.status).toBe(200);
    const entry = await h.entry(ENTRY.lunch);
    expect(entry.deleted_at).toBe(h.now.toISOString());
    expect(entry.deleted_by).toBe(1001);
    expect(await dining()).toBeUndefined();
    expect(h.textEdits()).toEqual([
      {
        chat_id: ALLOWED_CHAT_ID,
        message_id: CONFIRMATION.lunch,
        text: "🗑 removed · ₱250 · 🍽 Dining · Ana · today",
        reply_markup: { inline_keyboard: [[button("Restore", `r:${ENTRY.lunch}`)]] },
        link_preview_options: { is_disabled: true },
      },
    ]);
    expect(h.answers()).toEqual(["Removed."]);
    expect(h.sent()).toEqual([]);
  });

  it("Failure — the entry is already removed", async () => {
    await h.seedPreamble();
    await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });
    const removed = await h.entry(ENTRY.lunch);
    h.now = new Date(h.now.getTime() + 60_000);

    const response = await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch, from: BEN });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.lunch)).toEqual(removed);
    expect(removed.deleted_by).toBe(1001);
    expect(h.answers()).toEqual(["Removed.", "Already removed."]);
    expect(h.sent()).toEqual([]);
  });

  it("Edge case — the other member removes the entry", async () => {
    await h.seedPreamble();

    const response = await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch, from: BEN });

    expect(response.status).toBe(200);
    const entry = await h.entry(ENTRY.lunch);
    expect(entry.deleted_by).toBe(1002);
    expect(entry.payer_user_id).toBe(1001);
    expect(h.lastText(CONFIRMATION.lunch)).toBe("🗑 removed · ₱250 · 🍽 Dining · Ana · today");
  });

  it("Edge case — one entry of several", async () => {
    await h.seedPreamble();

    const response = await h.press(`u:${ENTRY.grab}`, { messageId: CONFIRMATION.multi });

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.grab)).deleted_at).not.toBeNull();
    expect((await h.entry(ENTRY.groceries)).deleted_at).toBeNull();
    expect(h.lastText(CONFIRMATION.multi)).toBe(
      [
        "✅ 1 of 2 entries · ₱2,340 · Ana · today",
        "1. 🗑 removed · ₱180 · 🚗 Transport · grab",
        "2. ₱2,340 · 🛒 Groceries · groceries gcash",
      ].join("\n"),
    );
    expect(h.lastButtons(CONFIRMATION.multi)).toEqual([
      [button("1 · Restore", `r:${ENTRY.grab}`)],
      [button("2 · Category", `c:${ENTRY.groceries}`), button("2 · Undo", `u:${ENTRY.groceries}`)],
    ]);
  });
});

describe("The system SHALL restore an entry when Restore is pressed", () => {
  it("Happy path — Restore brings the entry back", async () => {
    await h.seedPreamble();
    await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });

    const response = await h.press(`r:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });

    expect(response.status).toBe(200);
    const entry = await h.entry(ENTRY.lunch);
    expect(entry).toMatchObject({
      deleted_at: null,
      deleted_by: null,
      amount_centavos: 25000,
      category_id: "dining",
      updated_by: 1001,
    });
    expect(await dining()).toBe(25000);
    expect(h.lastText(CONFIRMATION.lunch)).toBe("✅ ₱250 · 🍽 Dining · Ana · today");
    expect(h.lastButtons(CONFIRMATION.lunch)).toEqual([
      [button("Category", `c:${ENTRY.lunch}`), button("Undo", `u:${ENTRY.lunch}`)],
    ]);
    expect(h.answers()).toEqual(["Removed.", "Restored."]);
  });

  it("Failure — the entry is already active", async () => {
    await h.seedPreamble();
    const before = await h.entry(ENTRY.lunch);

    const response = await h.press(`r:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch, from: BEN });

    expect(response.status).toBe(200);
    const after = await h.entry(ENTRY.lunch);
    expect(after).toEqual(before);
    expect(after.updated_by).toBe(1001);
    expect(h.answers()).toEqual(["Already active."]);
  });

  it("Edge case — a restored entry keeps a category picked before it was removed", async () => {
    await h.seedPreamble();
    await h.press(`s:${ENTRY.acai}:dining`, { messageId: CONFIRMATION.acai });
    await h.press(`u:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });

    const response = await h.press(`r:${ENTRY.acai}`, { messageId: CONFIRMATION.acai, from: BEN });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.acai)).toMatchObject({
      deleted_at: null,
      category_id: "dining",
      category_source: "manual",
    });
    expect(h.lastText(CONFIRMATION.acai)).toBe("✅ ₱150 · 🍽 Dining · Ana · today");
  });
});

describe("The system SHALL let a member pick a category from a grid", () => {
  it("Happy path — the grid opens", async () => {
    await h.seedPreamble();

    const response = await h.press(`c:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });

    expect(response.status).toBe(200);
    expect(h.textEdits()).toEqual([]);
    const edits = h.buttonEdits(CONFIRMATION.acai);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ chat_id: ALLOWED_CHAT_ID, message_id: CONFIRMATION.acai });
    const rows = edits[0]?.reply_markup?.inline_keyboard ?? [];
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual([
      button("🛒 Groceries", "s:12:groceries"),
      button("🍽 Dining", "s:12:dining"),
      button("🚗 Transport", "s:12:transport"),
    ]);
    expect(rows[4]).toEqual([button("❓ Other", "s:12:other"), button("🔁 Transfers", "s:12:transfer")]);
    expect(rows[5]).toEqual([button("Back", "b:12")]);
    expect(h.answers()).toEqual([undefined]);
  });

  it("Happy path — a category is picked", async () => {
    await h.seedPreamble();
    await h.press(`c:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });

    const response = await h.press(`s:${ENTRY.acai}:dining`, { messageId: CONFIRMATION.acai });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.acai)).toMatchObject({
      category_id: "dining",
      category_source: "manual",
      updated_by: 1001,
      updated_at: h.now.toISOString(),
    });
    expect(h.lastText(CONFIRMATION.acai)).toBe("✅ ₱150 · 🍽 Dining · Ana · today");
    expect(h.lastButtons(CONFIRMATION.acai)).toEqual([
      [button("Category", `c:${ENTRY.acai}`), button("Undo", `u:${ENTRY.acai}`)],
    ]);
    expect(h.sent()).toEqual([]);
  });

  it("Failure — the entry was removed meanwhile", async () => {
    await h.seedPreamble();
    await h.press(`c:${ENTRY.acai}`, { messageId: CONFIRMATION.acai, from: BEN });
    await h.press(`u:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });
    const removed = await h.entry(ENTRY.acai);

    const response = await h.press(`s:${ENTRY.acai}:dining`, { messageId: CONFIRMATION.acai, from: BEN });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.acai)).toEqual(removed);
    expect(removed.category_id).toBe("other");
    const { results } = await env.DB.prepare("SELECT keyword FROM keyword_map").all();
    expect(results).toEqual([]);
    expect(h.lastText(CONFIRMATION.acai)).toBe("🗑 removed · ₱150 · ❓ Other · Ana · today");
    expect(h.lastButtons(CONFIRMATION.acai)).toEqual([[button("Restore", `r:${ENTRY.acai}`)]]);
    expect(h.answers().at(-1)).toBe("This entry was removed.");
  });

  it("Failure — the grid of a removed entry", async () => {
    await h.seedPreamble();
    await h.press(`u:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });
    const removed = await h.entry(ENTRY.acai);

    const response = await h.press(`c:${ENTRY.acai}`, { messageId: CONFIRMATION.acai, from: BEN });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.acai)).toEqual(removed);
    expect(h.buttonEdits()).toEqual([]);
    expect(h.lastText(CONFIRMATION.acai)).toBe("🗑 removed · ₱150 · ❓ Other · Ana · today");
    expect(h.answers()).toEqual(["Removed.", "This entry was removed."]);
  });

  it("Failure — a category that is not in the list", async () => {
    await h.seedPreamble();
    const before = await h.entry(ENTRY.acai);

    const response = await h.press(`s:${ENTRY.acai}:snacks`, { messageId: CONFIRMATION.acai });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.acai)).toEqual(before);
    expect(h.textEdits()).toEqual([]);
    expect(h.buttonEdits()).toEqual([]);
    expect(h.answers()).toEqual([STALE]);
  });

  it("Edge case — Back", async () => {
    await h.seedPreamble();
    await h.press(`c:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });
    const before = await h.entry(ENTRY.acai);

    const response = await h.press(`b:${ENTRY.acai}`, { messageId: CONFIRMATION.acai });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.acai)).toEqual(before);
    expect(h.lastText(CONFIRMATION.acai)).toBe("✅ ₱150 · ❓ Other · Ana · today");
    expect(h.lastButtons(CONFIRMATION.acai)).toEqual([
      [button("Category", `c:${ENTRY.acai}`), button("Undo", `u:${ENTRY.acai}`)],
    ]);
    expect(h.answers()).toEqual([undefined, undefined]);
  });

  it("Edge case — the grid of one entry of several", async () => {
    await h.seedPreamble();
    const grab = await h.entry(ENTRY.grab);
    await h.press(`c:${ENTRY.groceries}`, { messageId: CONFIRMATION.multi });

    const response = await h.press(`s:${ENTRY.groceries}:household`, { messageId: CONFIRMATION.multi });

    expect(response.status).toBe(200);
    expect(await h.entry(ENTRY.groceries)).toMatchObject({ category_id: "household", category_source: "manual" });
    expect(await h.entry(ENTRY.grab)).toEqual(grab);
    expect(h.lastText(CONFIRMATION.multi)?.split("\n")[2]).toBe("2. ₱2,340 · 🧹 Household · groceries gcash");
  });
});

describe("The system SHALL ignore button data it cannot use", () => {
  async function expectIgnored(data: string): Promise<void> {
    const before = await h.entries();
    const callsBefore = h.telegram.calls.length;

    const response = await h.press(data, { messageId: CONFIRMATION.lunch });

    expect(response.status, data).toBe(200);
    expect(await h.entries(), data).toEqual(before);
    const calls = h.telegram.calls.slice(callsBefore);
    expect(
      calls.map((call) => call.method),
      data,
    ).toEqual(["answerCallbackQuery"]);
    expect((calls[0]?.payload as { text?: string }).text, data).toBe(STALE);
  }

  it("Happy path — an entry the ledger does not hold", async () => {
    await h.seedPreamble();

    await expectIgnored("u:424242");
  });

  it("Failure — malformed data", async () => {
    await h.seedPreamble();

    for (const data of ["u:", "u:abc", "u:7:extra", "s:7", "s:7:", "c:-7"]) await expectIgnored(data);
  });

  it("Edge case — an id that looks like 7 but is not written as one", async () => {
    await h.seedPreamble();

    for (const data of ["u:07", "u: 7", "u:7.0", "u:+7"]) await expectIgnored(data);
    expect((await h.entry(ENTRY.lunch)).deleted_at).toBeNull();
  });
});

describe("The system SHALL act on a press only from the entry's confirmation", () => {
  async function expectRefused(data: string, options: Parameters<typeof h.press>[1]): Promise<void> {
    const before = await h.entries();
    const callsBefore = h.telegram.calls.length;

    const response = await h.press(data, options);

    expect(response.status, data).toBe(200);
    expect(await h.entries(), data).toEqual(before);
    expect(h.telegram.calls.slice(callsBefore).map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(h.answers().at(-1)).toBe(STALE);
  }

  it("Happy path — a button on the entry's own confirmation", async () => {
    await h.seedPreamble();

    await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });

    expect((await h.entry(ENTRY.lunch)).deleted_at).not.toBeNull();
    expect(h.answers()).toEqual(["Removed."]);
  });

  it("Failure — an old button whose entry id was taken by a newer entry", async () => {
    // The ledger was emptied, and the next entry took id 1 again.
    const [reused] = await h.sendText("rent 12000", { messageId: 71, at: h.now, replyId: 950 });
    expect(reused).toBeDefined();
    const oldConfirmation = 400;

    for (const data of [`u:${reused}`, `c:${reused}`, `s:${reused}:dining`, `r:${reused}`, `b:${reused}`]) {
      await expectRefused(data, { messageId: oldConfirmation });
    }
    const learned = await env.DB.prepare("SELECT COUNT(*) AS count FROM keyword_map").first<{ count: number }>();
    expect(learned?.count).toBe(0);
  });

  it("Failure — a button on the confirmation of another message", async () => {
    await h.seedPreamble();

    await expectRefused(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.multi });
    await expectRefused(`s:${ENTRY.acai}:dining`, { messageId: CONFIRMATION.lunch });
  });

  it("Edge case — the confirmation id was never saved", async () => {
    await h.seedPreamble();
    await env.DB.prepare("UPDATE expenses SET confirmation_message_id = NULL WHERE id = ?").bind(ENTRY.lunch).run();

    await expectRefused(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });
    await expectRefused(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch, replyToMessageId: MESSAGE.multi });

    const response = await h.press(`u:${ENTRY.lunch}`, {
      messageId: CONFIRMATION.lunch,
      replyToMessageId: MESSAGE.lunch,
    });

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.lunch)).deleted_at).not.toBeNull();
    expect(h.answers().at(-1)).toBe("Removed.");
  });
});

describe("The system SHALL keep corrections safe to repeat", () => {
  it("Happy path — a failed edit is repeated", async () => {
    await h.seedPreamble();
    const update = h.pressUpdate(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });
    h.telegram.failNext("editMessageText");

    const first = await h.deliver(update);

    expect(first.status).toBe(500);
    const removed = await h.entry(ENTRY.lunch);
    expect(removed.deleted_at).not.toBeNull();
    expect(h.textEdits()).toEqual([]);

    const second = await h.redeliver(update);

    expect(second.status).toBe(200);
    expect(await h.entry(ENTRY.lunch)).toEqual(removed);
    expect(h.lastText(CONFIRMATION.lunch)).toBe("🗑 removed · ₱250 · 🍽 Dining · Ana · today");
  });

  it("Edge case — the message is already as asked", async () => {
    await h.seedPreamble();
    await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });
    h.log.mockClear();
    h.telegram.failNext("editMessageText", NOT_MODIFIED);

    const response = await h.press(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch, from: BEN });

    expect(response.status).toBe(200);
    expect(h.answers()).toEqual(["Removed.", "Already removed."]);
    expect(h.logs().filter((entry) => entry.event === "edit_skipped")).toEqual([]);
  });

  it("Edge case — the press cannot be answered", async () => {
    await h.seedPreamble();
    const update = h.pressUpdate(`u:${ENTRY.lunch}`, { messageId: CONFIRMATION.lunch });
    h.telegram.failNext("answerCallbackQuery");

    const response = await h.deliver(update);

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.lunch)).deleted_at).not.toBeNull();
    expect(h.lastText(CONFIRMATION.lunch)).toBe("🗑 removed · ₱250 · 🍽 Dining · Ana · today");
    expect(h.logs().filter((entry) => entry.event === "callback_answer_failed")).toEqual([
      { event: "callback_answer_failed", update_id: update.update_id },
    ]);
  });
});
