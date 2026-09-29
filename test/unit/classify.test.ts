import { describe, expect, it } from "vitest";
import { classifyUpdate, type Decision } from "../../src/gateway/classify";
import { ALLOWED_CHAT_ID, MEMBER_A, MEMBER_B } from "../helpers/constants";
import { callbackUpdate, editedMessageUpdate, messageUpdate } from "../helpers/updates";

const MEMBERS = [MEMBER_A.id, MEMBER_B.id] as const;
const OTHER_CHAT_ID = -1009999999999;
const NON_MEMBER_ID = 2001;
/** Telegram's sender for anonymous administrators and for the notice in a new supergroup. */
const GROUP_ANONYMOUS_BOT = { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" };
/** Telegram's sender for a message posted on behalf of a channel. */
const CHANNEL_BOT = { id: 136817688, is_bot: true, first_name: "Channel", username: "Channel_Bot" };

const OLD_GROUP_ID = -412345678;
const NEW_SUPERGROUP_ID = -1009876543210;

function classify(update: unknown, allowed: number | null = ALLOWED_CHAT_ID): Decision {
  return classifyUpdate(update, allowed, MEMBERS);
}

function ignored(reason: string): Decision {
  return { action: "ignore", reason } as Decision;
}

/** A plain message update with a replaced `message` object. */
function withMessage(message: Record<string, unknown>, updateId = 1): unknown {
  return { update_id: updateId, message };
}

function memberMessage(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const update = messageUpdate({ text: "coffee 120" });
  return { ...(update.message as unknown as Record<string, unknown>), ...extra };
}

/** The notice sent in the old group: it names the new supergroup. */
function migrateToNotice(from: unknown = { id: MEMBER_A.id, is_bot: false, first_name: MEMBER_A.firstName }) {
  return withMessage({
    message_id: 50,
    date: 1_780_000_000,
    chat: { id: OLD_GROUP_ID, type: "group", title: "Household" },
    ...(from === undefined ? {} : { from }),
    migrate_to_chat_id: NEW_SUPERGROUP_ID,
  }, 500);
}

/** The notice sent in the new supergroup: it names the old group. */
function migrateFromNotice(from: unknown = GROUP_ANONYMOUS_BOT) {
  return withMessage({
    message_id: 1,
    date: 1_780_000_000,
    chat: { id: NEW_SUPERGROUP_ID, type: "supergroup", title: "Household" },
    ...(from === undefined ? {} : { from }),
    sender_chat: { id: NEW_SUPERGROUP_ID, type: "supergroup", title: "Household" },
    migrate_from_chat_id: OLD_GROUP_ID,
  }, 501);
}

describe("classifyUpdate rule 1: unsupported type", () => {
  it.each([
    ["no content", { update_id: 1 }],
    ["a chat member change", { update_id: 1, my_chat_member: { chat: { id: ALLOWED_CHAT_ID } } }],
    ["a channel post", { update_id: 1, channel_post: { chat: { id: ALLOWED_CHAT_ID }, text: "hi" } }],
    ["an inline query", { update_id: 1, inline_query: { id: "q", from: { id: MEMBER_A.id }, query: "" } }],
  ])("ignores %s", (_label, update) => {
    expect(classify(update)).toEqual(ignored("unsupported_type"));
  });
});

describe("classifyUpdate rule 2: malformed", () => {
  const message = messageUpdate({ text: "hi" }).message;
  const callback = callbackUpdate({ data: "x:1" }).callback_query;

  it.each<[string, unknown]>([
    ["a message and an edited message", { update_id: 1, message, edited_message: message }],
    ["a message and a button press", { update_id: 1, message, callback_query: callback }],
    ["all three fields", { update_id: 1, message, edited_message: message, callback_query: callback }],
    ["a message that is a string", { update_id: 1, message: "hi" }],
    ["a message that is null", { update_id: 1, message: null }],
    ["a message that is a number", { update_id: 1, message: 5 }],
    ["an edited message that is a string", { update_id: 1, edited_message: "hi" }],
    ["a button press that is a string", { update_id: 1, callback_query: "x:1" }],
    ["a button press that is null", { update_id: 1, callback_query: null }],
    ["a message without a chat", withMessage(memberMessage({ chat: undefined }))],
    ["a message whose chat is not an object", withMessage(memberMessage({ chat: ALLOWED_CHAT_ID }))],
    ["a message whose chat has no id", withMessage(memberMessage({ chat: { type: "supergroup" } }))],
    [
      "a message whose chat id is text",
      withMessage(memberMessage({ chat: { id: String(ALLOWED_CHAT_ID), type: "supergroup" } })),
    ],
    [
      "an edited message without a chat",
      { update_id: 1, edited_message: { ...editedMessageUpdate({ text: "x" }).edited_message, chat: undefined } },
    ],
    [
      "a sender with a numeric id and no first name",
      withMessage(memberMessage({ from: { id: MEMBER_A.id, is_bot: false } })),
    ],
    [
      "a sender with a numeric id and a first name that is not text",
      withMessage(memberMessage({ from: { id: MEMBER_A.id, is_bot: false, first_name: 5 } })),
    ],
    [
      "a button press whose presser has a numeric id and no first name",
      { update_id: 1, callback_query: { ...callback, from: { id: MEMBER_A.id, is_bot: false } } },
    ],
    ["a migrate_to_chat_id that is text", withMessage(memberMessage({ migrate_to_chat_id: String(NEW_SUPERGROUP_ID) }))],
    [
      "a migrate_from_chat_id that is text",
      withMessage(memberMessage({ migrate_from_chat_id: String(OLD_GROUP_ID) })),
    ],
  ])("ignores %s", (_label, update) => {
    expect(classify(update)).toEqual(ignored("malformed"));
  });

  it("checks for malformed content before looking for an allowed chat", () => {
    expect(classify({ update_id: 1, message: "hi" }, null)).toEqual(ignored("malformed"));
  });
});

describe("classifyUpdate rule 3: button press without a chat", () => {
  it("ignores a press on an inline message", () => {
    const press = callbackUpdate({ data: "x:1" }).callback_query as unknown as Record<string, unknown>;
    const update = { update_id: 1, callback_query: { ...press, message: undefined, inline_message_id: "inline-1" } };
    expect(classify(update)).toEqual(ignored("no_chat"));
  });

  it("ignores a press whose message has no chat with a numeric id", () => {
    const press = callbackUpdate({ data: "x:1" }).callback_query as unknown as Record<string, unknown>;
    const message = press.message as Record<string, unknown>;
    expect(classify({ update_id: 1, callback_query: { ...press, message: { ...message, chat: undefined } } })).toEqual(
      ignored("no_chat"),
    );
    expect(
      classify({ update_id: 1, callback_query: { ...press, message: { ...message, chat: { id: "x" } } } }),
    ).toEqual(ignored("no_chat"));
  });
});

describe("classifyUpdate rule 4: guest or business message", () => {
  it("ignores a guest message in the allowed chat", () => {
    expect(classify(withMessage(memberMessage({ guest_query_id: "g-1" })))).toEqual(ignored("guest_or_business"));
  });

  it("ignores a business message in the allowed chat", () => {
    expect(classify(withMessage(memberMessage({ business_connection_id: "b-1" })))).toEqual(
      ignored("guest_or_business"),
    );
  });

  it("ignores an edited business message", () => {
    const edited = editedMessageUpdate({ text: "x" }).edited_message as unknown as Record<string, unknown>;
    expect(classify({ update_id: 1, edited_message: { ...edited, business_connection_id: "b-1" } })).toEqual(
      ignored("guest_or_business"),
    );
  });

  it("ignores a button press on a business message", () => {
    const press = callbackUpdate({ data: "x:1" }).callback_query as unknown as Record<string, unknown>;
    const message = press.message as Record<string, unknown>;
    const update = { update_id: 1, callback_query: { ...press, message: { ...message, business_connection_id: "b-1" } } };
    expect(classify(update)).toEqual(ignored("guest_or_business"));
  });

  it("checks for a guest message before looking for an allowed chat", () => {
    expect(classify(withMessage(memberMessage({ guest_query_id: "g-1" })), null)).toEqual(
      ignored("guest_or_business"),
    );
  });
});

describe("classifyUpdate rule 5: no allowed chat", () => {
  it("ignores a member's message when no allowed chat is stored", () => {
    expect(classify(messageUpdate({ text: "hi" }), null)).toEqual(ignored("no_allowed_chat"));
  });

  it("ignores a migration notice when no allowed chat is stored", () => {
    expect(classify(migrateToNotice(), null)).toEqual(ignored("no_allowed_chat"));
  });
});

describe("classifyUpdate rule 6: notice in the allowed chat", () => {
  it("migrates to the named supergroup", () => {
    expect(classify(migrateToNotice(), OLD_GROUP_ID)).toEqual({
      action: "migrate",
      kind: "message",
      chatId: OLD_GROUP_ID,
      userId: MEMBER_A.id,
      newChatId: NEW_SUPERGROUP_ID,
    });
  });

  it("migrates whoever the sender is", () => {
    const notice = migrateToNotice({ id: NON_MEMBER_ID, is_bot: false, first_name: "Stranger" });
    expect(classify(notice, OLD_GROUP_ID)).toMatchObject({
      action: "migrate",
      userId: NON_MEMBER_ID,
      newChatId: NEW_SUPERGROUP_ID,
    });
  });

  it("reports a null user id when the notice has no sender", () => {
    expect(classify(migrateToNotice(undefined), OLD_GROUP_ID)).toEqual({
      action: "migrate",
      kind: "message",
      chatId: OLD_GROUP_ID,
      userId: null,
      newChatId: NEW_SUPERGROUP_ID,
    });
  });
});

describe("classifyUpdate rule 7: notice in the new supergroup", () => {
  it("migrates to the message's own chat, sent by GroupAnonymousBot", () => {
    expect(classify(migrateFromNotice(), OLD_GROUP_ID)).toEqual({
      action: "migrate",
      kind: "message",
      chatId: NEW_SUPERGROUP_ID,
      userId: GROUP_ANONYMOUS_BOT.id,
      newChatId: NEW_SUPERGROUP_ID,
    });
  });

  it("reports a null user id when the notice has no sender", () => {
    expect(classify(migrateFromNotice(undefined), OLD_GROUP_ID)).toEqual({
      action: "migrate",
      kind: "message",
      chatId: NEW_SUPERGROUP_ID,
      userId: null,
      newChatId: NEW_SUPERGROUP_ID,
    });
  });
});

describe("classifyUpdate rule 8: migration already applied", () => {
  it("ignores a notice that names the allowed chat as the new chat", () => {
    expect(classify(migrateToNotice(), NEW_SUPERGROUP_ID)).toEqual(ignored("migration_already_applied"));
  });

  it("ignores a notice in the allowed chat that names an old chat", () => {
    expect(classify(migrateFromNotice(), NEW_SUPERGROUP_ID)).toEqual(ignored("migration_already_applied"));
  });
});

describe("classifyUpdate rule 9: unrelated migration", () => {
  it("ignores a notice in another chat that names another chat", () => {
    const notice = withMessage(memberMessage({ chat: { id: -400, type: "group" }, migrate_to_chat_id: -1004 }));
    expect(classify(notice)).toEqual(ignored("unrelated_migration"));
  });

  it("ignores a notice in another chat that names another old chat", () => {
    const notice = withMessage(
      memberMessage({ chat: { id: -1004, type: "supergroup" }, migrate_from_chat_id: -400 }),
    );
    expect(classify(notice)).toEqual(ignored("unrelated_migration"));
  });
});

describe("classifyUpdate rule 10: chat not allowed", () => {
  it("ignores a member's message in another group", () => {
    expect(classify(messageUpdate({ text: "hi", chatId: OTHER_CHAT_ID }))).toEqual(ignored("chat_not_allowed"));
  });

  it("ignores a member's message in a private chat", () => {
    const update = withMessage(memberMessage({ chat: { id: MEMBER_A.id, type: "private", first_name: "Ana" } }));
    expect(classify(update)).toEqual(ignored("chat_not_allowed"));
  });

  it("ignores a member's edited message and button press in another group", () => {
    expect(classify(editedMessageUpdate({ text: "hi", chatId: OTHER_CHAT_ID }))).toEqual(
      ignored("chat_not_allowed"),
    );
    expect(classify(callbackUpdate({ data: "x:1", chatId: OTHER_CHAT_ID }))).toEqual(ignored("chat_not_allowed"));
  });

  it("checks the chat before the sender", () => {
    expect(classify(messageUpdate({ text: "hi", chatId: OTHER_CHAT_ID, userId: NON_MEMBER_ID }))).toEqual(
      ignored("chat_not_allowed"),
    );
  });
});

describe("classifyUpdate rule 11: sender not a member", () => {
  it("ignores a non-member's message in the allowed chat", () => {
    expect(classify(messageUpdate({ text: "hi", userId: NON_MEMBER_ID }))).toEqual(ignored("sender_not_member"));
  });

  it("ignores a message without a sender", () => {
    expect(classify(withMessage(memberMessage({ from: undefined })))).toEqual(ignored("sender_not_member"));
  });

  it("ignores a sender without a numeric id", () => {
    expect(classify(withMessage(memberMessage({ from: { id: "1001", first_name: "Ana" } })))).toEqual(
      ignored("sender_not_member"),
    );
  });

  it("ignores an anonymous administrator's message", () => {
    const update = withMessage(
      memberMessage({ from: GROUP_ANONYMOUS_BOT, sender_chat: { id: ALLOWED_CHAT_ID, type: "supergroup" } }),
    );
    expect(classify(update)).toEqual(ignored("sender_not_member"));
  });

  it("ignores a message sent on behalf of a channel", () => {
    const update = withMessage(memberMessage({ from: CHANNEL_BOT, sender_chat: { id: -1005, type: "channel" } }));
    expect(classify(update)).toEqual(ignored("sender_not_member"));
  });

  it("ignores a button press by a non-member", () => {
    expect(classify(callbackUpdate({ data: "x:1", userId: NON_MEMBER_ID }))).toEqual(ignored("sender_not_member"));
  });
});

describe("classifyUpdate rule 12: process", () => {
  it("processes a member's message in the allowed chat", () => {
    expect(classify(messageUpdate({ text: "hi" }))).toEqual({
      action: "process",
      kind: "message",
      chatId: ALLOWED_CHAT_ID,
      userId: MEMBER_A.id,
      firstName: MEMBER_A.firstName,
      username: MEMBER_A.username,
    });
  });

  it("processes a member's edited message", () => {
    expect(classify(editedMessageUpdate({ text: "hi", userId: MEMBER_B.id, firstName: "Ben", username: "ben" })))
      .toEqual({
        action: "process",
        kind: "edited_message",
        chatId: ALLOWED_CHAT_ID,
        userId: MEMBER_B.id,
        firstName: "Ben",
        username: "ben",
      });
  });

  it("processes a button press with the presser as the sender, not the message's author", () => {
    const press = callbackUpdate({ data: "x:1", userId: MEMBER_B.id, firstName: "Ben" })
      .callback_query as unknown as Record<string, unknown>;
    const message = { ...(press.message as Record<string, unknown>), from: { id: 424242, is_bot: true, first_name: "Bot" } };
    const decision = classify({ update_id: 3, callback_query: { ...press, message } });
    expect(decision).toMatchObject({
      action: "process",
      kind: "callback_query",
      chatId: ALLOWED_CHAT_ID,
      userId: MEMBER_B.id,
      firstName: "Ben",
    });
    expect((decision as { username?: string }).username).toBeUndefined();
  });

  it("leaves out the username when the sender has none", () => {
    const decision = classify(messageUpdate({ text: "hi", firstName: "Ana" }));
    expect(decision).toMatchObject({ action: "process", userId: MEMBER_A.id, firstName: "Ana" });
    expect((decision as { username?: string }).username).toBeUndefined();
  });

  it("processes a member's photo message", () => {
    const update = withMessage(memberMessage({ text: undefined, photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] }));
    expect(classify(update)).toMatchObject({ action: "process", kind: "message", userId: MEMBER_A.id });
  });
});

describe("classifyUpdate never throws", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["a number", 5],
    ["a string", "update"],
    ["an array", [1, 2]],
    ["a message whose sender is a string", withMessage(memberMessage({ from: "Ana" }))],
  ])("returns an ignore decision for %s", (_label, update) => {
    expect(classify(update)).toMatchObject({ action: "ignore" });
  });
});

describe("supergroup migration in either order", () => {
  it("applies the notice in the old group first, then ignores the notice in the new supergroup", () => {
    const first = classify(migrateToNotice(), OLD_GROUP_ID);
    expect(first).toMatchObject({ action: "migrate", newChatId: NEW_SUPERGROUP_ID });
    expect(classify(migrateFromNotice(), NEW_SUPERGROUP_ID)).toEqual(ignored("migration_already_applied"));
  });

  it("applies the notice in the new supergroup first, then ignores the notice in the old group", () => {
    const first = classify(migrateFromNotice(), OLD_GROUP_ID);
    expect(first).toMatchObject({ action: "migrate", newChatId: NEW_SUPERGROUP_ID });
    expect(classify(migrateToNotice(), NEW_SUPERGROUP_ID)).toEqual(ignored("migration_already_applied"));
  });

  it("ignores a redelivered notice once it has been applied", () => {
    expect(classify(migrateToNotice(), NEW_SUPERGROUP_ID)).toEqual(ignored("migration_already_applied"));
    expect(classify(migrateFromNotice(), NEW_SUPERGROUP_ID)).toEqual(ignored("migration_already_applied"));
  });

  it("processes a member's message in the new supergroup after the migration", () => {
    expect(classify(messageUpdate({ text: "hi", chatId: NEW_SUPERGROUP_ID }), NEW_SUPERGROUP_ID)).toMatchObject({
      action: "process",
      chatId: NEW_SUPERGROUP_ID,
    });
    expect(classify(messageUpdate({ text: "hi", chatId: OLD_GROUP_ID }), NEW_SUPERGROUP_ID)).toEqual(
      ignored("chat_not_allowed"),
    );
  });
});
