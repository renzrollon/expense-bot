import { createMatcher, listKeywords } from "../categories";
import type { InlineKeyboardButton } from "grammy/types";
import type { BotContext, FeatureModule } from "../gateway/registry";
import { addMessageEntries, attachConfirmation, type NewEntryItem } from "../ledger";
import { parseExpenseMessage } from "../parser";
import { renderConfirmation } from "./confirmation";
import { rejectionText } from "./format";

/**
 * Turns a member's text message into ledger entries and one confirmation, as the
 * nine steps of design Decision 11. Every step is safe to repeat from the
 * database's state alone.
 */
export async function handleCapture(ctx: BotContext): Promise<void> {
  // 1. Only text (D35) that the member typed here: not a forward, and not sent through a bot.
  const message = ctx.message;
  if (message === undefined || typeof message.text !== "string") return;
  if (message.forward_origin !== undefined || message.via_bot !== undefined) return;
  const text = message.text;
  const { db, timezone, chatId, member, now } = ctx.gateway;

  // 2. Parse at the send time, not the attempt time (D34).
  const sentAt = new Date(message.date * 1000);
  const result = parseExpenseMessage(text, sentAt, timezone);

  // 3. Not an expense: nothing is stored and nothing is sent.
  if (result.kind === "not_expense") return;

  // 4. Rejected: one reply with the reason.
  if (result.kind === "rejected") {
    await reply(ctx, message.message_id, rejectionText(result.reason));
    return;
  }

  // 5. Categorize: one matcher per message (D56).
  const match = createMatcher(await listKeywords(db));
  const items: NewEntryItem[] = result.items.map((item) => {
    const category = match(item.description);
    return {
      amountCentavos: item.amountCentavos,
      description: item.description,
      spentOn: item.date,
      categoryId: category.categoryId,
      categorySource: category.source,
      checkAmount: item.flags.includes("ambiguous_amount"),
    };
  });

  // 6. Store, once.
  const { entries } = await addMessageEntries(db, {
    chatId,
    sourceMessageId: message.message_id,
    payerUserId: member.userId,
    byUserId: member.userId,
    rawText: text,
    parser: "rules",
    now,
    items,
  });

  // 7. Already confirmed by an earlier attempt (D36).
  if (entries.some((entry) => entry.confirmationMessageId !== null)) return;

  // 8. Confirm from the stored entries (D41), with the correction buttons (Decision 5).
  const view = renderConfirmation(entries, member.displayName, timezone);
  const sent = await reply(ctx, message.message_id, view.text, view.keyboard);

  // 9. Save the reply's id. A failure is logged and swallowed (D37).
  try {
    await attachConfirmation(db, chatId, message.message_id, sent.message_id);
  } catch {
    console.log(
      JSON.stringify({
        event: "capture_confirmation_unsaved",
        update_id: ctx.update.update_id,
        message_id: message.message_id,
        confirmation_message_id: sent.message_id,
      }),
    );
  }
}

/**
 * One plain-text reply to the member's message, still sent when that message was
 * deleted (D52), with link previews off (D38, D49). Buttons are attached only when
 * given, so a rejection carries none.
 */
async function reply(ctx: BotContext, messageId: number, text: string, keyboard?: InlineKeyboardButton[][]) {
  return ctx.reply(text, {
    reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
    ...(keyboard === undefined ? {} : { reply_markup: { inline_keyboard: keyboard } }),
  });
}

/** The capture feature module. It must stay the last message handler (Decision 1, D57). */
export const capture: FeatureModule = { name: "capture", messages: [handleCapture] };
