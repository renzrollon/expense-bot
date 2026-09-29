import type { UpdateKind } from "./classify";

export const LEASE_MS = 120_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_SECONDS = 5;

export interface ClaimInput {
  updateId: number;
  kind: UpdateKind;
  chatId: number;
  userId: number | null;
  raw: string;
  now: Date;
}

export type Unclaimed = "finished" | "in_progress" | "exhausted";

export type ClaimResult =
  | { outcome: "claimed"; attempt: number }
  | { outcome: Unclaimed };

export interface UpdateRecord {
  status: string;
  attempts: number;
  claimedAt: string;
}

const ERROR_MAX = 500;

function leaseCutoff(now: Date): string {
  return new Date(now.getTime() - LEASE_MS).toISOString();
}

export function resolveUnclaimed(record: UpdateRecord | null, now: Date): Unclaimed {
  if (record === null) return "in_progress";
  if (record.status === "done" || record.status === "parked") return "finished";
  if (record.attempts >= MAX_ATTEMPTS) {
    if (record.status === "failed") return "exhausted";
    if (record.status === "processing" && record.claimedAt < leaseCutoff(now)) return "exhausted";
  }
  return "in_progress";
}

export async function claimUpdate(db: D1Database, input: ClaimInput): Promise<ClaimResult> {
  const nowText = input.now.toISOString();
  const cutoff = leaseCutoff(input.now);
  const claimed = await db
    .prepare(
      `INSERT INTO updates (update_id, kind, chat_id, user_id, raw, status, attempts, received_at, claimed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'processing', 1, ?6, ?6)
       ON CONFLICT (update_id) DO UPDATE SET
         status = 'processing',
         attempts = attempts + 1,
         claimed_at = excluded.claimed_at
       WHERE updates.attempts < ${MAX_ATTEMPTS}
         AND (updates.status = 'failed'
              OR (updates.status = 'processing' AND updates.claimed_at < ?7))
       RETURNING attempts`,
    )
    .bind(input.updateId, input.kind, input.chatId, input.userId, input.raw, nowText, cutoff)
    .first<{ attempts: number }>();
  if (claimed) return { outcome: "claimed", attempt: claimed.attempts };

  const row = await db
    .prepare("SELECT status, attempts, claimed_at FROM updates WHERE update_id = ?")
    .bind(input.updateId)
    .first<{ status: string; attempts: number; claimed_at: string }>();
  const record: UpdateRecord | null = row
    ? { status: row.status, attempts: row.attempts, claimedAt: row.claimed_at }
    : null;
  const outcome = resolveUnclaimed(record, input.now);
  if (outcome === "exhausted") {
    await db
      .prepare(
        `UPDATE updates SET status = 'parked'
         WHERE update_id = ?1 AND attempts >= ${MAX_ATTEMPTS}
           AND (status = 'failed' OR (status = 'processing' AND claimed_at < ?2))`,
      )
      .bind(input.updateId, cutoff)
      .run();
  }
  return { outcome };
}

export async function finishUpdate(db: D1Database, updateId: number, now: Date): Promise<void> {
  await db
    .prepare("UPDATE updates SET status = 'done', finished_at = ? WHERE update_id = ? AND status = 'processing'")
    .bind(now.toISOString(), updateId)
    .run();
}

export async function failUpdate(
  db: D1Database,
  updateId: number,
  error: unknown,
  now: Date,
): Promise<"failed" | "parked"> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX);
  const row = await db
    .prepare(
      `UPDATE updates SET
         status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'parked' ELSE 'failed' END,
         last_error = ?1,
         finished_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN ?2 ELSE finished_at END
       WHERE update_id = ?3 AND status = 'processing'
       RETURNING status`,
    )
    .bind(message, now.toISOString(), updateId)
    .first<{ status: string }>();
  return row?.status === "parked" ? "parked" : "failed";
}

export async function getLastReceivedAt(db: D1Database, exceptUpdateId: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT MAX(received_at) AS last FROM updates WHERE update_id <> ?")
    .bind(exceptUpdateId)
    .first<{ last: string | null }>();
  return row?.last ?? null;
}

export async function getParked(db: D1Database, limit: number): Promise<{ count: number; ids: number[] }> {
  const [countResult, idsResult] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM updates WHERE status = 'parked'"),
    db
      .prepare("SELECT update_id FROM updates WHERE status = 'parked' ORDER BY received_at DESC, update_id DESC LIMIT ?")
      .bind(limit),
  ]);
  const count = (countResult?.results[0] as { count: number } | undefined)?.count ?? 0;
  const ids = ((idsResult?.results ?? []) as { update_id: number }[]).map((r) => r.update_id);
  return { count, ids };
}
