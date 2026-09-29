import type { Update } from "grammy/types";
import { SECRET_HEADER, WEBHOOK_SECRET } from "./constants";

export interface SignedRequestOptions {
  /** Header value. `null` leaves the header out. Defaults to the test secret. */
  secret?: string | null;
  method?: string;
  path?: string;
  /** Raw body text, used instead of the serialised update. */
  body?: string;
  headers?: Record<string, string>;
}

/** Builds a request to /webhook that carries the update as JSON text. */
export function signedRequest(
  update: Update | unknown,
  options: SignedRequestOptions = {},
): Request {
  const headers = new Headers({ "content-type": "application/json", ...options.headers });
  const secret = options.secret === undefined ? WEBHOOK_SECRET : options.secret;
  if (secret !== null) headers.set(SECRET_HEADER, secret);
  const method = options.method ?? "POST";
  const body = options.body ?? JSON.stringify(update);
  return new Request(`https://bot.test${options.path ?? "/webhook"}`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
}
