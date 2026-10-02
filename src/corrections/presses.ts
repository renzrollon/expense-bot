import { categoryGrid } from "../capture/confirmation";
import { categoryLabel, shorten } from "../capture/format";
import { getCategory, learnableKeyword, teachKeyword } from "../categories";
import { STALE_BUTTON_NOTICE } from "../gateway/bot";
import type { BotContext } from "../gateway/registry";
import { getEntry, restoreEntry, setEntryCategory, softDeleteEntry, type Entry } from "../ledger";
import { answerPress, showButtons, type EditTarget } from "../telegram/inplace";
import { parsePress, type Press, type PressKind } from "./data";
import { refreshConfirmation } from "./refresh";

/**
 * The five press handlers of the confirmation buttons. Each follows the six steps
 * of design Decision 6: parse, read the entry, change the ledger, teach (for `s`),
 * set the message the button is on to the current state, and answer last.
 */

const REMOVED_NOTICE = "This entry was removed.";

/** What steps 3 and 4 decided: the entry after the change, and the notice of step 6. */
interface Outcome {
  entry: Entry;
  notice?: string;
  /** Step 5 shows the grid instead of the current state. */
  grid?: boolean;
}

type Apply = (ctx: BotContext, press: Press, entry: Entry) => Promise<Outcome | null>;

function isActive(entry: Entry): boolean {
  return entry.deletedAt === null;
}

/** The message the button is on, taken from the press itself. */
function pressedMessage(ctx: BotContext): EditTarget | null {
  const message = ctx.callbackQuery?.message;
  return message === undefined ? null : { chatId: message.chat.id, messageId: message.message_id };
}

function handler(kind: PressKind, apply: Apply): (ctx: BotContext, payload: string) => Promise<void> {
  return async (ctx, payload) => {
    // 1. Parse the data.
    const press = parsePress(kind, payload);
    if (press === null) return answerPress(ctx, STALE_BUTTON_NOTICE);

    // 2. Read the entry.
    const found = await getEntry(ctx.gateway.db, press.entryId);
    if (found === null) return answerPress(ctx, STALE_BUTTON_NOTICE);

    // 3 and 4. Change the ledger, and teach.
    const outcome = await apply(ctx, press, found);
    if (outcome === null) return answerPress(ctx, STALE_BUTTON_NOTICE);

    // 5. Set the message the button is on.
    const target = pressedMessage(ctx);
    if (target !== null) {
      const { entry } = outcome;
      if (outcome.grid === true) await showButtons(ctx.api, target, categoryGrid(entry.id), ctx.update.update_id);
      else await refreshConfirmation(ctx, entry, target);
    }

    // 6. Answer last.
    await answerPress(ctx, outcome.notice);
  };
}

/** The ledger outcome of a guarded change, or null when the entry is gone. */
function changed(
  result: Awaited<ReturnType<typeof softDeleteEntry>>,
  notices: { changed: string; unchanged: string },
): Outcome | null {
  if (result.outcome === "not_found") return null;
  return { entry: result.entry, notice: result.outcome === "changed" ? notices.changed : notices.unchanged };
}

/** Teaches the entry's description for the picked category, when it is learnable, and gives the notice (Decision 10). */
async function teach(ctx: BotContext, entry: Entry, categoryId: string): Promise<string> {
  const keyword = learnableKeyword(entry.description);
  if (keyword === null) return `Filed under ${categoryLabel(categoryId)}.`;
  const shortName = getCategory(categoryId)?.shortName ?? categoryId;
  const { db, member, now } = ctx.gateway;
  await teachKeyword(db, { keyword, categoryId, taughtBy: member.userId, now });
  return `${shorten(keyword)}: ${shortName} from now on`;
}

/** `c:<entry id>`: shows the category grid of an active entry (design Decision 6). */
export const pressCategory = handler("c", async (_ctx, _press, entry) =>
  isActive(entry) ? { entry, grid: true } : { entry, notice: REMOVED_NOTICE },
);

/** `s:<entry id>:<category id>`: sets the category by hand and teaches the keyword (Decisions 6 and 10). */
export const pressSelect = handler("s", async (ctx, press, entry) => {
  if (press.kind !== "s") return null;
  const { db, member, now } = ctx.gateway;
  const result = await setEntryCategory(db, {
    id: entry.id,
    byUserId: member.userId,
    now,
    categoryId: press.categoryId,
    categorySource: "manual",
  });
  if (result.outcome === "not_found") return null;
  const after = result.entry;
  // Teach whether this attempt changed the entry or an earlier one did.
  if (!isActive(after) || after.categoryId !== press.categoryId) return { entry: after, notice: REMOVED_NOTICE };
  return { entry: after, notice: await teach(ctx, after, press.categoryId) };
});

/** `u:<entry id>`: removes the entry (design Decision 6). */
export const pressUndo = handler("u", async (ctx, _press, entry) => {
  const { db, member, now } = ctx.gateway;
  return changed(await softDeleteEntry(db, { id: entry.id, byUserId: member.userId, now }), {
    changed: "Removed.",
    unchanged: "Already removed.",
  });
});

/** `r:<entry id>`: restores the entry (design Decision 6). */
export const pressRestore = handler("r", async (ctx, _press, entry) => {
  const { db, member, now } = ctx.gateway;
  return changed(await restoreEntry(db, { id: entry.id, byUserId: member.userId, now }), {
    changed: "Restored.",
    unchanged: "Already active.",
  });
});

/** `b:<entry id>`: leaves the grid; the ledger is not changed (design Decision 6). */
export const pressBack = handler("b", async (_ctx, _press, entry) => ({ entry }));
