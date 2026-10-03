import { categoryLabel, formatPesos, shorten } from "../capture/format";
import type { BotContext } from "../gateway/registry";
import { findLatestActiveEntry, findRemovalAt, softDeleteEntry, type Entry } from "../ledger";
import { refreshConfirmation } from "./refresh";

const NOTHING_TO_UNDO = "Nothing to undo.";

/**
 * `/undo`: removes the sender's latest active entry (design Decision 8). The removal
 * is stamped with the command's send time, which is the same on every attempt, so a
 * repeated attempt finds the entry this command already removed and removes no other.
 * Text after the command is ignored.
 */
export async function handleUndo(ctx: BotContext): Promise<void> {
  const message = ctx.msg;
  if (message === undefined) return;
  const { db, member } = ctx.gateway;
  const sentAt = new Date(message.date * 1000);

  // 1. This command already removed an entry on an earlier attempt.
  let removed = await findRemovalAt(db, member.userId, sentAt);
  if (removed === null) {
    // 2. The sender's latest active entry.
    const latest = await findLatestActiveEntry(db, member.userId);
    if (latest === null) return reply(ctx, NOTHING_TO_UNDO);

    // 3. Remove it. Another outcome means a button removed it in the same moment.
    const result = await softDeleteEntry(db, { id: latest.id, byUserId: member.userId, now: sentAt });
    if (result.outcome !== "changed") return reply(ctx, NOTHING_TO_UNDO);
    removed = result.entry;
  }

  // 4. Set its confirmation to the current state, when its id is known.
  if (removed.confirmationMessageId !== null) {
    await refreshConfirmation(ctx, removed, { chatId: removed.chatId, messageId: removed.confirmationMessageId });
  }

  // 5. Reply.
  await reply(ctx, removedText(removed));
}

/** `↩️ Removed <amount> · <category>`, then ` · <description>` when it is not empty. */
function removedText(entry: Entry): string {
  const parts = [formatPesos(entry.amountCentavos), categoryLabel(entry.categoryId)];
  if (entry.description !== "") parts.push(shorten(entry.description));
  return `↩️ Removed ${parts.join(" · ")}`;
}

/**
 * One message, sent as a reply to the command, with link previews off. It is still
 * sent when the command message was deleted, because the entry is already removed.
 */
async function reply(ctx: BotContext, text: string): Promise<void> {
  const messageId = ctx.msg?.message_id;
  await ctx.reply(text, {
    ...(messageId === undefined ? {} : { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } }),
    link_preview_options: { is_disabled: true },
  });
}
