import type { BotContext } from "../gateway/registry";
import { findEntriesBySourceMessage, markSourceEdited } from "../ledger";
import { showConfirmation } from "./refresh";

/**
 * Marks the confirmation of a logged message that was edited (design Decision 9).
 * Nothing in the entries changes but the edit mark, and no new message is sent: the
 * confirmation, set to its current state, gains the notice line.
 */
export async function handleEdited(ctx: BotContext): Promise<void> {
  // 1. Only an edit with text.
  const message = ctx.editedMessage;
  if (message === undefined || typeof message.text !== "string") return;
  const { db, chatId, now } = ctx.gateway;

  // 2. A message that was never logged: nothing, silently.
  const stored = await findEntriesBySourceMessage(db, chatId, message.message_id);
  const first = stored[0];
  if (first === undefined) return;

  // 3. The text did not change.
  if (message.text === first.rawText) return;

  // 4. Mark the edit. A second edit marks nothing new.
  const entries = await markSourceEdited(db, chatId, message.message_id, now);

  // 5. Set the confirmation to its current state, when its id is known.
  const confirmationId = entries.find((entry) => entry.confirmationMessageId !== null)?.confirmationMessageId;
  if (confirmationId === undefined || confirmationId === null) return;
  await showConfirmation(ctx, entries, { chatId, messageId: confirmationId });
}
