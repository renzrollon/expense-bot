import { InputFile } from "grammy";
import { listKeywordRows } from "../categories";
import { listMembers } from "../gateway/members";
import type { JobContext } from "../gateway/registry";
import { listBackupEntries } from "../ledger";
import { previousMonth, shortDate } from "../reports/periods";
import { sendOnce } from "../scheduler/sends";
import { entriesCsv, keywordsCsv } from "./files";

/** The name of the nightly backup job (design Decision 16). */
export const NIGHTLY_BACKUP_JOB = "nightly_backup";

const NOT_A_CHAT_ID = "BACKUP_CHAT_ID is not a chat id";
const WHOLE_NUMBER = /^-?\d+$/;

/**
 * The chat the backup goes to (Decision 16): `BACKUP_CHAT_ID` when it is set, as a
 * whole number or as text holding one, else the group. Any other value throws
 * `BACKUP_CHAT_ID is not a chat id`, so the run fails and `/ping` shows it.
 */
export function readBackupChatId(env: object, groupChatId: number): number {
  const value: unknown = Reflect.get(env, "BACKUP_CHAT_ID");
  if (value === undefined) return groupChatId;
  const id = typeof value === "number" ? value : typeof value === "string" && WHOLE_NUMBER.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id)) throw new Error(NOT_A_CHAT_ID);
  return id;
}

/**
 * The `nightly_backup` job (Decision 16). Sends the entries file, then the learned
 * keywords file, to the backup chat without a notification sound, each at most once
 * for the scheduled date. A failed send fails the run; the retry skips a part that
 * was already sent.
 */
export async function runNightlyBackup(job: JobContext): Promise<void> {
  const { db, api, now, scheduledDate } = job;
  const chatId = readBackupChatId(job.env, job.chatId);
  const day = shortDate(scheduledDate);
  const options = { disable_notification: true } as const;

  await sendOnce(db, { job: NIGHTLY_BACKUP_JOB, scheduledDate, part: "entries" }, now, async () => {
    const first = previousMonth(scheduledDate).from;
    const entries = await listBackupEntries(db, { datedFrom: first, changedSince: `${first}T00:00:00.000Z` });
    const names = new Map((await listMembers(db)).map((member) => [member.userId, member.displayName]));
    const csv = entriesCsv(entries, { names, full: true });
    return api.sendDocument(chatId, file(csv, `backup-entries-${scheduledDate}.csv`), {
      ...options,
      caption: `🗄 Backup · ${day} · ${plural(entries.length, "entry", "entries")}`,
    });
  });

  await sendOnce(db, { job: NIGHTLY_BACKUP_JOB, scheduledDate, part: "keywords" }, now, async () => {
    const rows = await listKeywordRows(db);
    return api.sendDocument(chatId, file(keywordsCsv(rows), `backup-keywords-${scheduledDate}.csv`), {
      ...options,
      caption: `🗄 Learned keywords · ${day} · ${plural(rows.length, "keyword", "keywords")}`,
    });
  });
}

function file(csv: string, fileName: string): InputFile {
  return new InputFile(new TextEncoder().encode(csv), fileName);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
