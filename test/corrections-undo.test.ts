import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { softDeleteEntry } from "../src/ledger";
import { ALLOWED_CHAT_ID } from "./helpers/constants";
import { BEN, button, CONFIRMATION, ENTRY, useCorrectionsHarness } from "./helpers/ledger-fixtures";

const COMMAND_ID = 60;

const h = useCorrectionsHarness();

async function activeIds(): Promise<number[]> {
  return (await h.entries()).filter((row) => row.deleted_at === null).map((row) => row.id);
}

describe("The system SHALL remove the sender's latest entry on /undo", () => {
  it("Happy path — /undo removes the latest entry", async () => {
    await h.seedPreamble();

    const response = await h.command("/undo");

    expect(response.status).toBe(200);
    const entry = await h.entry(ENTRY.acai);
    expect(entry.deleted_by).toBe(1001);
    expect(entry.deleted_at).toBe(new Date(Math.floor(h.now.getTime() / 1000) * 1000).toISOString());
    expect(await activeIds()).toEqual([ENTRY.lunch, ENTRY.grab, ENTRY.groceries]);
    expect(h.textEdits()).toEqual([
      {
        chat_id: ALLOWED_CHAT_ID,
        message_id: CONFIRMATION.acai,
        text: "🗑 removed · ₱150 · ❓ Other · Ana · today",
        reply_markup: { inline_keyboard: [[button("Restore", `r:${ENTRY.acai}`)]] },
        link_preview_options: { is_disabled: true },
      },
    ]);
    const sent = h.sent();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe("↩️ Removed ₱150 · ❓ Other · acai");
    expect(sent[0]?.reply_parameters?.message_id).toBe(COMMAND_ID);
  });

  it("Failure — nothing to undo", async () => {
    await h.seedPreamble();
    const before = await h.entries();

    const response = await h.command("/undo", { from: BEN });

    expect(response.status).toBe(200);
    expect(await h.entries()).toEqual(before);
    expect(h.textEdits()).toEqual([]);
    expect(h.sent().map((payload) => payload.text)).toEqual(["Nothing to undo."]);
  });

  it("Edge case — the command is processed twice", async () => {
    await h.seedPreamble();
    const update = h.commandUpdate("/undo");
    h.telegram.failNext("sendMessage");

    const first = await h.deliver(update);

    expect(first.status).toBe(500);
    const removed = await h.entry(ENTRY.acai);
    expect(removed.deleted_at).not.toBeNull();
    expect(h.sent()).toEqual([]);

    const second = await h.redeliver(update);

    expect(second.status).toBe(200);
    expect((await h.entry(ENTRY.groceries)).deleted_at).toBeNull();
    expect(await h.entry(ENTRY.acai)).toEqual(removed);
    expect(await activeIds()).toEqual([ENTRY.lunch, ENTRY.grab, ENTRY.groceries]);
    expect(h.sent().map((payload) => payload.text)).toEqual(["↩️ Removed ₱150 · ❓ Other · acai"]);
  });

  it("Edge case — only the sender's entries", async () => {
    await h.seedPreamble();
    const [taxi = 0] = await h.sendText("taxi 200", {
      from: BEN,
      messageId: 46,
      at: new Date("2026-09-29T02:05:00.000Z"),
      replyId: 906,
    });
    h.telegram.calls.length = 0;

    const response = await h.command("/undo");

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.acai)).deleted_by).toBe(1001);
    expect((await h.entry(taxi)).deleted_at).toBeNull();
    expect(h.sent().map((payload) => payload.text)).toEqual(["↩️ Removed ₱150 · ❓ Other · acai"]);
  });

  it("Edge case — the latest entry is one of several", async () => {
    await h.seedPreamble();
    await softDeleteEntry(env.DB, { id: ENTRY.acai, byUserId: 1001, now: new Date("2026-09-29T02:05:00.000Z") });

    const response = await h.command("/undo");

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.groceries)).deleted_by).toBe(1001);
    expect((await h.entry(ENTRY.grab)).deleted_at).toBeNull();
    expect(h.lastText(CONFIRMATION.multi)?.split("\n")[0]).toBe("✅ 1 of 2 entries · ₱180 · Ana · today");
    expect(h.sent().map((payload) => payload.text)).toEqual(["↩️ Removed ₱2,340 · 🛒 Groceries · groceries gcash"]);
  });

  it("Edge case — the confirmation id is not known", async () => {
    await h.seedPreamble();
    await env.DB.prepare("UPDATE expenses SET confirmation_message_id = NULL WHERE id = ?").bind(ENTRY.acai).run();

    const response = await h.command("/undo");

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.acai)).deleted_at).not.toBeNull();
    expect(h.textEdits()).toEqual([]);
    expect(h.buttonEdits()).toEqual([]);
    expect(h.sent().map((payload) => payload.text)).toEqual(["↩️ Removed ₱150 · ❓ Other · acai"]);
  });

  it("Edge case — text after the command is ignored", async () => {
    await h.seedPreamble();

    const response = await h.command(`/undo ${ENTRY.lunch}`);

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.acai)).deleted_at).not.toBeNull();
    expect((await h.entry(ENTRY.lunch)).deleted_at).toBeNull();
    expect(h.sent().map((payload) => payload.text)).toEqual(["↩️ Removed ₱150 · ❓ Other · acai"]);
  });

  it("Edge case — a long description is shortened", async () => {
    await h.seedPreamble();
    const long = "x".repeat(70);
    await h.sendText(`${long} 100`, { messageId: 46, at: new Date("2026-09-29T02:05:00.000Z"), replyId: 906 });
    h.telegram.calls.length = 0;

    const response = await h.command("/undo");

    expect(response.status).toBe(200);
    expect(h.sent().map((payload) => payload.text)).toEqual([`↩️ Removed ₱100 · ❓ Other · ${"x".repeat(59)}…`]);
  });
});

describe("The system SHALL keep corrections safe to repeat", () => {
  it("Failure — the confirmation was deleted", async () => {
    await h.seedPreamble();
    for (const id of [ENTRY.grab, ENTRY.groceries, ENTRY.acai]) {
      await softDeleteEntry(env.DB, { id, byUserId: 1001, now: new Date("2026-09-29T02:05:00.000Z") });
    }
    h.telegram.failNext("editMessageText", { error_code: 400, description: "Bad Request: message to edit not found" });
    const update = h.commandUpdate("/undo");

    const response = await h.deliver(update);

    expect(response.status).toBe(200);
    expect((await h.entry(ENTRY.lunch)).deleted_by).toBe(1001);
    expect(h.sent().map((payload) => payload.text)).toEqual(["↩️ Removed ₱250 · 🍽 Dining · lunch"]);
    const skipped = h.logs().filter((entry) => entry.event === "edit_skipped");
    expect(skipped).toEqual([{ event: "edit_skipped", update_id: update.update_id }]);
    const raw = h.log.mock.calls.map((args) => String(args[0])).join("\n");
    expect(raw).not.toContain("lunch");
    expect(raw).not.toContain("Ana");
  });
});
