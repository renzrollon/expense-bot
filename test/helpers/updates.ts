import type { MessageEntity, Update } from "grammy/types";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./constants";

export interface UpdateOptions {
  updateId?: number;
  messageId?: number;
  chatId?: number;
  userId?: number;
  firstName?: string;
  username?: string;
  date?: number;
}

export interface MessageOptions extends UpdateOptions {
  text: string;
}

export interface PhotoOptions extends UpdateOptions {
  caption?: string;
}

export interface CallbackOptions extends UpdateOptions {
  data?: string;
}

/**
 * Telegram always sends a bot_command entity at offset 0 for text that starts
 * with "/". Its length covers the command and any @username.
 */
export function commandEntities(text: string): MessageEntity[] | undefined {
  if (!text.startsWith("/")) return undefined;
  const end = text.search(/\s/);
  return [{ type: "bot_command", offset: 0, length: end === -1 ? text.length : end }];
}

function base(options: UpdateOptions) {
  return {
    updateId: options.updateId ?? 1,
    messageId: options.messageId ?? 10,
    date: options.date ?? 1_780_000_000,
    chat: { id: options.chatId ?? ALLOWED_CHAT_ID, type: "supergroup" as const, title: "Household" },
    from: {
      id: options.userId ?? MEMBER_A.id,
      is_bot: false as const,
      first_name: options.firstName ?? MEMBER_A.firstName,
      ...(options.username === undefined && options.firstName === undefined
        ? { username: MEMBER_A.username }
        : options.username === undefined
          ? {}
          : { username: options.username }),
    },
  };
}

export function messageUpdate(options: MessageOptions): Update {
  const b = base(options);
  const entities = commandEntities(options.text);
  return {
    update_id: b.updateId,
    message: {
      message_id: b.messageId,
      date: b.date,
      chat: b.chat,
      from: b.from,
      text: options.text,
      ...(entities ? { entities } : {}),
    },
  };
}

export function photoUpdate(options: PhotoOptions = {}): Update {
  const b = base(options);
  const captionEntities = options.caption === undefined ? undefined : commandEntities(options.caption);
  return {
    update_id: b.updateId,
    message: {
      message_id: b.messageId,
      date: b.date,
      chat: b.chat,
      from: b.from,
      photo: [{ file_id: "photo-1", file_unique_id: "u-photo-1", width: 90, height: 90 }],
      ...(options.caption === undefined ? {} : { caption: options.caption }),
      ...(captionEntities ? { caption_entities: captionEntities } : {}),
    },
  };
}

/** A sticker message, which carries no `text`. */
export function stickerUpdate(options: UpdateOptions = {}): Update {
  const b = base(options);
  return {
    update_id: b.updateId,
    message: {
      message_id: b.messageId,
      date: b.date,
      chat: b.chat,
      from: b.from,
      sticker: {
        file_id: "sticker-1",
        file_unique_id: "u-sticker-1",
        type: "regular",
        width: 512,
        height: 512,
        is_animated: false,
        is_video: false,
      },
    },
  };
}

/** A voice note, which carries no `text`. */
export function voiceUpdate(options: UpdateOptions = {}): Update {
  const b = base(options);
  return {
    update_id: b.updateId,
    message: {
      message_id: b.messageId,
      date: b.date,
      chat: b.chat,
      from: b.from,
      voice: { file_id: "voice-1", file_unique_id: "u-voice-1", duration: 3 },
    },
  };
}

export function editedMessageUpdate(options: MessageOptions & { editDate?: number }): Update {
  const b = base(options);
  const entities = commandEntities(options.text);
  return {
    update_id: b.updateId,
    edited_message: {
      message_id: b.messageId,
      date: b.date,
      edit_date: options.editDate ?? b.date + 60,
      chat: b.chat,
      from: b.from,
      text: options.text,
      ...(entities ? { entities } : {}),
    },
  };
}

export function callbackUpdate(options: CallbackOptions = {}): Update {
  const b = base(options);
  return {
    update_id: b.updateId,
    callback_query: {
      id: `cb-${b.updateId}`,
      from: b.from,
      chat_instance: "chat-instance-1",
      ...(options.data === undefined ? {} : { data: options.data }),
      message: {
        message_id: b.messageId,
        date: b.date,
        chat: b.chat,
        text: "Choose",
      },
    },
  };
}
