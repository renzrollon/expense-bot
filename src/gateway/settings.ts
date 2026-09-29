const ALLOWED_CHAT_ID_KEY = "allowed_chat_id";

export async function getAllowedChatId(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(ALLOWED_CHAT_ID_KEY)
    .first<{ value: string }>();
  if (!row || !/^-?\d+$/.test(row.value)) return null;
  const id = Number(row.value);
  return Number.isSafeInteger(id) ? id : null;
}

export async function setAllowedChatId(db: D1Database, chatId: number, now: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(ALLOWED_CHAT_ID_KEY, String(chatId), now.toISOString())
    .run();
}
