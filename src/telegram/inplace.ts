import { GrammyError, type Api } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { BotContext } from "../gateway/registry";

/**
 * The only code that edits a bot message or answers a button press (design Decision 7).
 * A 400 from an edit is permanent and is swallowed; any other error is transient and
 * is thrown, so the gateway's retry repeats the handler.
 */

/** The bot message to edit. */
export interface EditTarget {
  chatId: number;
  messageId: number;
}

/** What the message shows after the edit. An empty keyboard removes the buttons. */
export interface EditView {
  text: string;
  keyboard: InlineKeyboardButton[][];
}

const NOT_MODIFIED = "message is not modified";

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

/** Runs one edit, swallowing a 400 and logging it unless it says nothing changed. */
async function edit(updateId: number, call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if (!(error instanceof GrammyError) || error.error_code !== 400) throw error;
    if (!error.description.includes(NOT_MODIFIED)) log({ event: "edit_skipped", update_id: updateId });
  }
}

/** Replaces the text and the buttons of a bot message, with link previews off and no parse mode. */
export async function editInPlace(api: Api, target: EditTarget, view: EditView, updateId: number): Promise<void> {
  await edit(updateId, () =>
    api.editMessageText(target.chatId, target.messageId, view.text, {
      reply_markup: { inline_keyboard: view.keyboard },
      link_preview_options: { is_disabled: true },
    }),
  );
}

/** Replaces only the buttons of a bot message. */
export async function showButtons(
  api: Api,
  target: EditTarget,
  keyboard: InlineKeyboardButton[][],
  updateId: number,
): Promise<void> {
  await edit(updateId, () =>
    api.editMessageReplyMarkup(target.chatId, target.messageId, { reply_markup: { inline_keyboard: keyboard } }),
  );
}

/**
 * Answers the press of this update. Never throws: on a retry the press is usually too
 * old to answer, and that must not fail an attempt that did its work.
 */
export async function answerPress(ctx: BotContext, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text === undefined ? undefined : { text });
  } catch {
    log({ event: "callback_answer_failed", update_id: ctx.update.update_id });
  }
}
