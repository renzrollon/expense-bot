import type { InlineKeyboardButton } from "grammy/types";
import { CATEGORIES } from "../categories";
import type { Entry } from "../ledger";
import { localDate } from "../parser/dates";
import { categoryLabel, dateLabel, formatPesos, shorten } from "./format";

/** A confirmation's text and buttons (design Decision 5). */
export interface ConfirmationView {
  text: string;
  keyboard: InlineKeyboardButton[][];
}

const SEPARATOR = " · ";
const CHECK_AMOUNT = "⚠️ check amount";
const REMOVED = "🗑 removed";
const EDIT_NOTICE = "✏️ Edit not applied. Undo and resend.";
const GRID_COLUMNS = 3;

function isActive(entry: Entry): boolean {
  return entry.deletedAt === null;
}

/** The amount check is shown on an active entry only. */
function withCheck(parts: string[], entry: Entry): string {
  return (entry.checkAmount && isActive(entry) ? [...parts, CHECK_AMOUNT] : parts).join(SEPARATOR);
}

function button(text: string, data: string): InlineKeyboardButton {
  return { text, callback_data: data };
}

/** One row per entry: `Category` and `Undo` while active, `Restore` once removed. */
function entryRow(entry: Entry, label: (name: string) => string): InlineKeyboardButton[] {
  return isActive(entry)
    ? [button(label("Category"), `c:${entry.id}`), button(label("Undo"), `u:${entry.id}`)]
    : [button(label("Restore"), `r:${entry.id}`)];
}

/**
 * The confirmation of one message's stored entries, in plain text, with its
 * correction buttons (the `expense-capture` requirement "The confirmation shows
 * the current state of its entries"). A pure function of its arguments: the date
 * word is relative to the local date on which the first entry was stored.
 */
export function renderConfirmation(entries: readonly Entry[], payerName: string, timezone: string): ConfirmationView {
  const first = entries[0];
  if (first === undefined) return { text: "", keyboard: [] };
  const date = dateLabel(first.spentOn, localDate(new Date(first.createdAt), timezone));
  const active = entries.filter(isActive);
  const edited = entries.some((entry) => entry.sourceEditedAt !== null);

  let lines: string[];
  let keyboard: InlineKeyboardButton[][];
  if (entries.length === 1) {
    const amount = isActive(first)
      ? [`✅ ${formatPesos(first.amountCentavos)}`]
      : [REMOVED, formatPesos(first.amountCentavos)];
    lines = [withCheck([...amount, categoryLabel(first.categoryId), payerName, date], first)];
    keyboard = [entryRow(first, (name) => name)];
  } else {
    const total = active.reduce((sum, entry) => sum + entry.amountCentavos, 0);
    const count =
      active.length === entries.length ? `${entries.length} entries` : `${active.length} of ${entries.length} entries`;
    const mark = active.length === 0 ? "🗑" : "✅";
    const header = [`${mark} ${count}`, formatPesos(total), payerName, date].join(SEPARATOR);
    const items = entries.map((entry, i) => {
      const prefix = isActive(entry) ? `${i + 1}.` : `${i + 1}. ${REMOVED} ·`;
      const parts = [`${prefix} ${formatPesos(entry.amountCentavos)}`, categoryLabel(entry.categoryId)];
      if (entry.description !== "") parts.push(shorten(entry.description));
      return withCheck(parts, entry);
    });
    lines = [header, ...items];
    keyboard = entries.map((entry, i) => entryRow(entry, (name) => `${i + 1}${SEPARATOR}${name}`));
  }

  if (edited && active.length > 0) lines.push(EDIT_NOTICE);
  return { text: lines.join("\n"), keyboard };
}

/**
 * The category grid of one entry: every category in display order, 3 to a row,
 * with the data `s:<entry id>:<category id>`, then one row with `Back` (`b:<entry id>`).
 */
export function categoryGrid(entryId: number): InlineKeyboardButton[][] {
  const ordered = [...CATEGORIES].sort((a, b) => a.order - b.order);
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < ordered.length; i += GRID_COLUMNS) {
    rows.push(
      ordered
        .slice(i, i + GRID_COLUMNS)
        .map((category) => button(`${category.emoji} ${category.shortName}`, `s:${entryId}:${category.id}`)),
    );
  }
  rows.push([button("Back", `b:${entryId}`)]);
  return rows;
}
