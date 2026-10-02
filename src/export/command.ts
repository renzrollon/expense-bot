import { InputFile } from "grammy";
import { listMembers } from "../gateway/members";
import type { BotContext } from "../gateway/registry";
import { listEntries, type Period } from "../ledger";
import { localDate } from "../parser/dates";
import { daysInMonth, monthStart, monthTitle } from "../reports/periods";
import { entriesCsv } from "./files";

/** The description `/help` shows for `/export` (data-export, "export entries on /export"). */
export const EXPORT_DESCRIPTION = "CSV file: /export, /export 2026-08, /export all";

const USAGE = "Usage: /export, /export 2026-08 or /export all";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Every date the ledger can hold. */
const ALL_DATES: Period = { from: "0001-01-01", to: "9999-12-31" };

/** What one `/export` asks for. */
interface Selection {
  period: Period;
  fileName: string;
  /** The caption without the count, such as `📄 August 2026`. */
  title: string;
  /** The reply when no active entry matches. */
  empty: string;
}

/**
 * The `/export` handler (design Decision 15). Replies to the command with one
 * message: the active entries of the selected month, or of every month, as a CSV
 * document, or a text when nothing matches or the text is not understood.
 */
export async function handleExport(ctx: BotContext, args: string): Promise<void> {
  const { db, now, timezone } = ctx.gateway;
  const selection = select(args, localDate(now, timezone));
  if (selection === null) {
    await replyText(ctx, USAGE);
    return;
  }

  const entries = await listEntries(db, selection.period);
  if (entries.length === 0) {
    await replyText(ctx, selection.empty);
    return;
  }

  const names = new Map((await listMembers(db)).map((member) => [member.userId, member.displayName]));
  const csv = entriesCsv(entries, { names, full: false });
  const count = entries.length === 1 ? "1 entry" : `${entries.length} entries`;
  await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(csv), selection.fileName), {
    caption: `${selection.title} · ${count}`,
    ...replyTo(ctx),
  });
}

/** The selection for the command's text, trimmed and lower-cased once; `null` when it is not understood. */
function select(args: string, today: string): Selection | null {
  const text = args.trim().toLowerCase();
  if (text === "all") {
    return { period: ALL_DATES, fileName: "expenses-all.csv", title: "📄 All months", empty: "No entries yet." };
  }
  if (text !== "" && !MONTH.test(text)) return null;
  const from = text === "" ? monthStart(today) : `${text}-01`;
  const month = from.slice(0, 7);
  const name = monthTitle(from);
  return {
    period: { from, to: `${month}-${String(daysInMonth(from)).padStart(2, "0")}` },
    fileName: `expenses-${month}.csv`,
    title: `📄 ${name}`,
    empty: `No entries for ${name}.`,
  };
}

async function replyText(ctx: BotContext, text: string): Promise<void> {
  await ctx.reply(text, { ...replyTo(ctx), link_preview_options: { is_disabled: true } });
}

function replyTo(ctx: BotContext): { reply_parameters?: { message_id: number } } {
  const messageId = ctx.msg?.message_id;
  return messageId === undefined ? {} : { reply_parameters: { message_id: messageId } };
}
