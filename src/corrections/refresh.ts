import { renderConfirmation } from "../capture/confirmation";
import { getMember } from "../gateway/members";
import type { BotContext } from "../gateway/registry";
import { findEntriesBySourceMessage, type Entry } from "../ledger";
import { editInPlace, type EditTarget } from "../telegram/inplace";

/** The message whose entries a confirmation shows. */
export interface SourceMessage {
  chatId: number;
  sourceMessageId: number;
}

/** The member's display name, or the user id as text when there is no member record (design Decision 5). */
export async function payerName(db: D1Database, userId: number): Promise<string> {
  const member = await getMember(db, userId);
  return member?.displayName ?? String(userId);
}

/**
 * Sets a confirmation to show these entries, which are all the entries of one
 * message in item order (design Decision 6, step 5). Nothing is edited for no entries.
 */
export async function showConfirmation(ctx: BotContext, entries: readonly Entry[], target: EditTarget): Promise<void> {
  const first = entries[0];
  if (first === undefined) return;
  const { db, timezone } = ctx.gateway;
  const view = renderConfirmation(entries, await payerName(db, first.payerUserId), timezone);
  await editInPlace(ctx.api, target, view, ctx.update.update_id);
}

/** Sets a confirmation to the current state of its message's entries (design Decision 6, step 5). */
export async function refreshConfirmation(ctx: BotContext, message: SourceMessage, target: EditTarget): Promise<void> {
  const entries = await findEntriesBySourceMessage(ctx.gateway.db, message.chatId, message.sourceMessageId);
  await showConfirmation(ctx, entries, target);
}
