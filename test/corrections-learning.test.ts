import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listKeywordRows } from "../src/categories";
import { failingDb } from "./helpers/db";
import { BEN, CONFIRMATION, ENTRY, type Member, useCorrectionsHarness } from "./helpers/ledger-fixtures";
import { messageUpdate } from "./helpers/updates";

const h = useCorrectionsHarness();

/** When the later messages of a scenario are sent: 10:20 and on, after the preamble and the presses. */
function later(minutes: number): Date {
  return new Date(Date.UTC(2026, 8, 29, 2, 20 + minutes));
}

/** Picks the category for an entry from its grid, as the given member. */
async function pick(entryId: number, categoryId: string, confirmationId: number, from?: Member) {
  await h.press(`c:${entryId}`, { messageId: confirmationId, ...(from === undefined ? {} : { from }) });
  return h.press(`s:${entryId}:${categoryId}`, { messageId: confirmationId, ...(from === undefined ? {} : { from }) });
}

async function categoryOf(id: number): Promise<{ category_id: string; category_source: string }> {
  const row = await h.entry(id);
  return { category_id: row.category_id, category_source: row.category_source };
}

describe("The system SHALL learn a keyword from a manual pick", () => {
  it("Happy path — a correction is learned", async () => {
    await h.seedPreamble();

    const response = await pick(ENTRY.acai, "dining", CONFIRMATION.acai);

    expect(response.status).toBe(200);
    expect(h.answers().at(-1)).toBe("acai: Dining from now on");
    const rows = await listKeywordRows(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ keyword: "acai", categoryId: "dining", source: "learned", taughtBy: 1001 });

    const [bens] = await h.sendText("acai 150", { from: BEN, messageId: 70, at: later(0) });
    expect(await categoryOf(bens ?? 0)).toEqual({ category_id: "dining", category_source: "learned" });
  });

  it("Failure — a description that is not learnable", async () => {
    await h.seedPreamble();
    const [id] = await h.sendText("lunch with ana at jollibee 900", { messageId: 46, at: later(0), replyId: 906 });
    expect(id).toBe(13);
    expect(await categoryOf(13)).toEqual({ category_id: "dining", category_source: "keyword" });

    const response = await pick(13, "gifts", 906);

    expect(response.status).toBe(200);
    expect(await categoryOf(13)).toEqual({ category_id: "gifts", category_source: "manual" });
    expect(await listKeywordRows(env.DB)).toEqual([]);
    expect(h.answers().at(-1)).toBe("Filed under 🎁 Gifts.");
  });

  it("Edge case — the same keyword is corrected again", async () => {
    await h.seedPreamble();
    await pick(ENTRY.acai, "dining", CONFIRMATION.acai);
    h.now = new Date(h.now.getTime() + 60_000);

    const response = await h.press(`s:${ENTRY.acai}:groceries`, { messageId: CONFIRMATION.acai, from: BEN });

    expect(response.status).toBe(200);
    const rows = await listKeywordRows(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ keyword: "acai", categoryId: "groceries", source: "learned", taughtBy: 1002 });
    expect(h.answers().at(-1)).toBe("acai: Groceries from now on");

    const [next] = await h.sendText("acai 150", { messageId: 70, at: later(0) });
    expect(await categoryOf(next ?? 0)).toEqual({ category_id: "groceries", category_source: "learned" });
  });

  it("Edge case — an empty description", async () => {
    await h.seedPreamble();
    const [id = 0] = await h.sendText("250", { messageId: 47, at: later(0), replyId: 907 });
    expect((await h.entry(id)).description).toBe("");

    const response = await pick(id, "dining", 907);

    expect(response.status).toBe(200);
    expect((await h.entry(id)).category_id).toBe("dining");
    expect(await listKeywordRows(env.DB)).toEqual([]);
    expect(h.answers().at(-1)).toBe("Filed under 🍽 Dining.");
  });

  it("Edge case — the bot is deployed again", async () => {
    await h.seedPreamble();
    await pick(ENTRY.acai, "dining", CONFIRMATION.acai);
    expect(h.answers().at(-1)).toBe("acai: Dining from now on");

    const redeployed = h.gateway();
    h.now = later(0);
    const update = messageUpdate({
      text: "acai 150",
      updateId: 5000,
      messageId: 70,
      date: Math.floor(later(0).getTime() / 1000),
    });
    const response = await h.deliver(update, { gateway: redeployed });

    expect(response.status).toBe(200);
    const stored = await h.entries();
    const sent = stored.find((row) => row.source_message_id === 70);
    expect(sent).toMatchObject({ category_id: "dining", category_source: "learned" });
  });

  it("Edge case — casing and spacing of the description", async () => {
    await h.seedPreamble();
    const [id = 0] = await h.sendText("Açaí  Bowl 180", { messageId: 48, at: later(0), replyId: 908 });
    expect((await h.entry(id)).category_id).toBe("other");

    const response = await pick(id, "dining", 908);

    expect(response.status).toBe(200);
    const rows = await listKeywordRows(env.DB);
    expect(rows.map((row) => [row.keyword, row.categoryId])).toEqual([["acai bowl", "dining"]]);
    expect(h.answers().at(-1)).toBe("acai bowl: Dining from now on");

    const [next = 0] = await h.sendText("ACAI BOWL 180", { messageId: 71, at: later(1) });
    expect(await categoryOf(next)).toEqual({ category_id: "dining", category_source: "learned" });
  });

  it("Edge case — a pick repeated after a failed teaching still teaches", async () => {
    await h.seedPreamble();
    const failing = failingDb(env.DB);
    failing.failWhen((sql) => sql.includes("INSERT INTO keyword_map"));
    const update = h.pressUpdate(`s:${ENTRY.acai}:dining`, { messageId: CONFIRMATION.acai });

    const first = await h.deliver(update, { env: { ...env, DB: failing.db } });

    expect(first.status).toBe(500);
    expect(await categoryOf(ENTRY.acai)).toEqual({ category_id: "dining", category_source: "manual" });
    expect(await listKeywordRows(env.DB)).toEqual([]);

    failing.heal();
    const second = await h.redeliver(update);

    expect(second.status).toBe(200);
    const rows = await listKeywordRows(env.DB);
    expect(rows.map((row) => [row.keyword, row.categoryId, row.taughtBy])).toEqual([["acai", "dining", 1001]]);
    expect(h.answers().at(-1)).toBe("acai: Dining from now on");
  });
});
