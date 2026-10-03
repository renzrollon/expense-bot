import { GrammyError, HttpError } from "grammy";

/**
 * A short code for why an attempt failed, for a log entry. It never holds the error
 * message, which can carry ledger content: `telegram_<error code>` when Telegram
 * refused a call, `telegram_unreachable` when the call got no answer (a network error
 * or a timeout), `database` for a D1 error, and `other` for anything else.
 */
export function failureReason(error: unknown): string {
  if (error instanceof GrammyError) return `telegram_${error.error_code}`;
  if (error instanceof HttpError) return "telegram_unreachable";
  if (error instanceof Error && error.message.startsWith("D1_")) return "database";
  return "other";
}
