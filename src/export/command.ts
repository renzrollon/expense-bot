import { InputFile } from "grammy";
import { listMembers } from "../gateway/members";
import type { BotContext } from "../gateway/registry";
import { countActiveEntries, listEntries, type Period } from "../ledger";
import { localDate } from "../parser/dates";
import { daysInMonth, monthStart, monthTitle } from "../reports/periods";
import { entriesCsv } from "./files";

/** The description `/help` shows for `/export` (data-export, "export entries on /export"). */
export const EXPORT_DESCRIPTION = "CSV file: /export, /export 2026-08, /export all";

const USAGE = "Usage: /export, /export 2026-08 or /export all";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Every date the ledger can hold. */
const ALL_DATES: Period = { from: "0001-01-01", to: "9999-12-31" };
/**
 * The most entries `/export all` puts in one file. Reading and encoding a row costs
 * CPU time, and the Workers Free plan allows about 10 ms for a request: 2,000 rows
 * took 9 ms when measured. Past the limit the Worker would be stopped without a reply.
 * On the Workers Paid plan this can be raised.
 */
export const EXPORT_ALL_MAX_ENTRIES = 1500;

/** What one `/export` asks for. */
interface Selection {
  period: Period;
  fileName: string;
  /** The caption without the count, such as `📄 August 2026`. */
  title: string;
  /** The reply when no active entry matches. */
  empty: string;
  /** The most entries the file may hold; no limit when absent. */
  limit?: number;
}

/**
 * The `/export` handler (design Decision 15). Replies to the command with one
 * message: the active entries of the selected month, or of every month, as a CSV
 * document, or a text when nothing matches, when every month holds more entries
 * than one file may, or when the text is not understood.
 */
export async function handleExport(ctx: BotContext, args: string): Promise<void> {
  const { db, now, timezone } = ctx.gateway;
  const today = localDate(now, timezone);
  const selection = select(args, today);
  if (selection === null) {
    await replyText(ctx, USAGE);
    return;
  }

  if (selection.limit !== undefined) {
    const count = await countActiveEntries(db, selection.period);
    if (count > selection.limit) {
      await replyText(ctx, tooManyText(count, selection.limit, today));
      return;
    }
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
    return {
      period: ALL_DATES,
      fileName: "expenses-all.csv",
      title: "📄 All months",
      empty: "No entries yet.",
      limit: EXPORT_ALL_MAX_ENTRIES,
    };
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

/** The reply when every month holds more entries than one file may, with this month as the example. */
function tooManyText(count: number, limit: number, today: string): string {
  return `📄 ${count} entries are more than one file holds (${limit}). Export one month at a time, such as /export ${today.slice(0, 7)}.`;
}

async function replyText(ctx: BotContext, text: string): Promise<void> {
  await ctx.reply(text, { ...replyTo(ctx), link_preview_options: { is_disabled: true } });
}

/** A reply to the command message, still sent when that message was deleted. */
function replyTo(ctx: BotContext): { reply_parameters?: { message_id: number; allow_sending_without_reply: true } } {
  const messageId = ctx.msg?.message_id;
  return messageId === undefined ? {} : { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } };
}
