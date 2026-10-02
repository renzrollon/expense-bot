/** One message a job sends for one scheduled date (Decision 12). */
export interface SendKey {
  job: string;
  /** YYYY-MM-DD, household time. */
  scheduledDate: string;
  /** Names one of the messages the job sends for the date. */
  part: string;
}

/** The message a send produced, as grammY returns it. */
export interface SentMessage {
  chat: { id: number };
  message_id: number;
}

export type SendOutcome = "sent" | "already_sent" | "nothing_to_send";

/**
 * Performs `send` unless a record for `key` exists, then records the sent message
 * (Decision 12). An error from `send` passes on and stores nothing. `null` from
 * `send` stores nothing. A record that cannot be stored is logged, not thrown.
 */
export async function sendOnce(
  db: D1Database,
  key: SendKey,
  now: Date,
  send: () => Promise<SentMessage | null>,
): Promise<SendOutcome> {
  const existing = await db
    .prepare("SELECT 1 FROM job_sends WHERE job = ? AND scheduled_date = ? AND part = ?")
    .bind(key.job, key.scheduledDate, key.part)
    .first();
  if (existing !== null) return "already_sent";

  const sent = await send();
  if (sent === null) return "nothing_to_send";

  try {
    await db
      .prepare(
        `INSERT INTO job_sends (job, scheduled_date, part, chat_id, message_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(key.job, key.scheduledDate, key.part, sent.chat.id, sent.message_id, now.toISOString())
      .run();
  } catch {
    console.log(
      JSON.stringify({ event: "job_send_unsaved", job: key.job, scheduled_date: key.scheduledDate, part: key.part }),
    );
  }
  return "sent";
}
