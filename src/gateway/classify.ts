export type UpdateKind = "message" | "edited_message" | "callback_query";

export type IgnoreReason =
  | "unsupported_type"
  | "malformed"
  | "no_chat"
  | "guest_or_business"
  | "no_allowed_chat"
  | "migration_already_applied"
  | "unrelated_migration"
  | "chat_not_allowed"
  | "sender_not_member";

export type Decision =
  | { action: "ignore"; reason: IgnoreReason }
  | { action: "migrate"; kind: "message"; chatId: number; userId: number | null; newChatId: number }
  | { action: "process"; kind: UpdateKind; chatId: number; userId: number; firstName: string; username?: string };

type Obj = Record<string, unknown>;

const KINDS: readonly UpdateKind[] = ["message", "edited_message", "callback_query"];

/**
 * Decides what the gateway does with an update (Decision 5). Pure and total:
 * any shape it does not understand yields an ignore decision, and it never throws.
 * The rules are checked in order and the first one that applies decides.
 */
export function classifyUpdate(
  update: unknown,
  allowedChatId: number | null,
  memberIds: readonly number[],
): Decision {
  try {
    return classify(update, allowedChatId, memberIds);
  } catch {
    // Unreachable by construction; kept so the function stays total.
    return ignore("malformed");
  }
}

function classify(update: unknown, allowedChatId: number | null, memberIds: readonly number[]): Decision {
  if (!isObject(update)) return ignore("malformed");

  // Rule 1: none of the supported fields.
  const present = KINDS.filter((kind) => update[kind] !== undefined);
  if (present.length === 0) return ignore("unsupported_type");

  // Rule 2: malformed.
  if (present.length > 1) return ignore("malformed");
  const kind = present[0] as UpdateKind;
  const content = update[kind];
  if (!isObject(content)) return ignore("malformed");

  let message: Obj | undefined;
  let sender: unknown;
  if (kind === "callback_query") {
    sender = content["from"];
    const pressed = content["message"];
    message = isObject(pressed) ? pressed : undefined;
  } else {
    if (chatIdOf(content) === null) return ignore("malformed");
    message = content;
    sender = content["from"];
  }
  if (isMalformedSender(sender)) return ignore("malformed");
  if (message !== undefined && hasMalformedMigrationField(message)) return ignore("malformed");

  // Rule 3: a button press with no message in a chat with a numeric id.
  const chatId = message === undefined ? null : chatIdOf(message);
  if (message === undefined || chatId === null) return ignore("no_chat");

  // Rule 4: guest or business message.
  if (message["guest_query_id"] !== undefined || message["business_connection_id"] !== undefined) {
    return ignore("guest_or_business");
  }

  // Rule 5: no allowed chat stored.
  if (allowedChatId === null) return ignore("no_allowed_chat");

  if (kind === "message") {
    const migrateTo = message["migrate_to_chat_id"];
    const migrateFrom = message["migrate_from_chat_id"];
    const userId = numericId(sender);

    // Rule 6: notice in the allowed chat, naming the new supergroup.
    if (typeof migrateTo === "number" && chatId === allowedChatId) {
      return { action: "migrate", kind: "message", chatId, userId, newChatId: migrateTo };
    }
    // Rule 7: notice in the new supergroup, naming the allowed chat as the old one.
    if (typeof migrateFrom === "number" && migrateFrom === allowedChatId) {
      return { action: "migrate", kind: "message", chatId, userId, newChatId: chatId };
    }
    // Rule 8: the migration has already been applied.
    if (
      (typeof migrateTo === "number" && migrateTo === allowedChatId) ||
      (typeof migrateFrom === "number" && chatId === allowedChatId)
    ) {
      return ignore("migration_already_applied");
    }
    // Rule 9: a migration that does not concern the allowed chat.
    if (migrateTo !== undefined || migrateFrom !== undefined) return ignore("unrelated_migration");
  }

  // Rule 10: chat not allowed.
  if (chatId !== allowedChatId) return ignore("chat_not_allowed");

  // Rule 11: sender missing, without a numeric id, or not a member.
  const userId = numericId(sender);
  if (userId === null || !memberIds.includes(userId) || !isObject(sender)) return ignore("sender_not_member");

  // Rule 12: process.
  const firstName = sender["first_name"] as string;
  const username = sender["username"];
  return typeof username === "string"
    ? { action: "process", kind, chatId, userId, firstName, username }
    : { action: "process", kind, chatId, userId, firstName };
}

function ignore(reason: IgnoreReason): Decision {
  return { action: "ignore", reason };
}

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The numeric id of the message's chat, or null when it has none. */
function chatIdOf(message: Obj): number | null {
  const chat = message["chat"];
  if (!isObject(chat)) return null;
  const id = chat["id"];
  return isNumber(id) ? id : null;
}

/** The sender's numeric id, or null when there is no sender with a numeric id. */
function numericId(sender: unknown): number | null {
  if (!isObject(sender)) return null;
  const id = sender["id"];
  return isNumber(id) ? id : null;
}

/** A sender with a numeric id must have a first name as text. */
function isMalformedSender(sender: unknown): boolean {
  return numericId(sender) !== null && typeof (sender as Obj)["first_name"] !== "string";
}

function hasMalformedMigrationField(message: Obj): boolean {
  for (const field of ["migrate_to_chat_id", "migrate_from_chat_id"]) {
    const value = message[field];
    if (value !== undefined && !isNumber(value)) return true;
  }
  return false;
}
