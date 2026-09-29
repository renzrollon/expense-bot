export interface Member {
  userId: number;
  displayName: string;
}

export async function refreshMember(
  db: D1Database,
  sender: { userId: number; firstName: string; username?: string },
  now: Date,
): Promise<Member> {
  const username = sender.username ?? null;
  const nowText = now.toISOString();
  await db
    .prepare(
      `INSERT INTO members (user_id, display_name, username, first_seen_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = excluded.display_name,
         username = excluded.username,
         updated_at = excluded.updated_at
       WHERE members.display_name IS NOT excluded.display_name
          OR members.username IS NOT excluded.username`,
    )
    .bind(sender.userId, sender.firstName, username, nowText)
    .run();
  return { userId: sender.userId, displayName: sender.firstName };
}

export async function getMember(db: D1Database, userId: number): Promise<Member | null> {
  const row = await db
    .prepare("SELECT user_id, display_name FROM members WHERE user_id = ?")
    .bind(userId)
    .first<{ user_id: number; display_name: string }>();
  return row ? { userId: row.user_id, displayName: row.display_name } : null;
}
