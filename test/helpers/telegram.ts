export interface TelegramCall {
  method: string;
  payload: unknown;
  /** Present, and true, only on a call that `failNext` failed. */
  failed?: true;
}

/** The payload recorded for a `multipart/form-data` request, such as an upload. */
export interface MultipartPayload {
  /** Every part without a file name, by its field name. */
  fields: Record<string, string>;
  /** Every part with a file name, in the order sent, its content read as UTF-8 text. */
  files: { field: string; fileName: string; text: string }[];
}

/** The error answer `failNext` gives. */
export interface InjectedError {
  error_code: number;
  description: string;
  /** Telegram's `parameters`, such as the `retry_after` of a rate limit. */
  parameters?: { retry_after?: number };
}

export interface TelegramStub {
  calls: TelegramCall[];
  /** Sets the `result` returned for a method. The default is `true`. */
  setResult(method: string, result: unknown): void;
  /**
   * The next call to the method is recorded with `failed: true` and answered with
   * `{ ok: false, error_code, description }` and that HTTP status. The default is
   * 500 and "Internal Server Error: injected". Later calls answer as before.
   */
  failNext(method: string, error?: InjectedError): void;
  /** Calls recorded for one method. */
  callsTo(method: string): TelegramCall[];
  restore(): void;
}

const TELEGRAM_URL = /^https:\/\/api\.telegram\.org\/(?:file\/)?bot[^/]*\/([^/?#]+)/;

/** The value of one parameter of a header, such as `name` in a content-disposition, quoted or not. */
function headerParam(header: string, param: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${param}\\s*=\\s*(?:"([^"]*)"|([^;]*))`, "i").exec(header);
  if (!match) return undefined;
  return match[1] ?? match[2]?.trim();
}

/** Splits a multipart body at its boundary into fields and files. */
function parseMultipart(body: string, boundary: string): MultipartPayload {
  const payload: MultipartPayload = { fields: {}, files: [] };
  const delimiter = `--${boundary}`;
  // The first piece is the preamble, and the last starts with "--", the close delimiter.
  for (const piece of body.split(delimiter).slice(1)) {
    if (piece.startsWith("--")) break;
    // Each part sits between the CRLF that ends a delimiter line and the CRLF before the next one.
    const part = piece.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const end = part.indexOf("\r\n\r\n");
    const headers = end === -1 ? part : part.slice(0, end);
    const content = end === -1 ? "" : part.slice(end + 4);
    const disposition = headers.split("\r\n").find((line) => /^content-disposition\s*:/i.test(line)) ?? "";
    const field = headerParam(disposition, "name") ?? "";
    const fileName = headerParam(disposition, "filename");
    if (fileName === undefined) payload.fields[field] = content;
    else payload.files.push({ field, fileName, text: content });
  }
  return payload;
}

function contentTypeOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.headers !== undefined) return new Headers(init.headers).get("content-type") ?? "";
  return input instanceof Request ? (input.headers.get("content-type") ?? "") : "";
}

async function readPayload(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const contentType = contentTypeOf(input, init);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const boundary = headerParam(contentType, "boundary") ?? "";
    const body =
      init?.body !== undefined && init.body !== null
        ? await new Response(init.body).text()
        : input instanceof Request
          ? await input.clone().text()
          : "";
    return parseMultipart(body, boundary);
  }
  let text: string | undefined;
  if (typeof init?.body === "string") text = init.body;
  else if (input instanceof Request) text = await input.clone().text();
  if (text === undefined || text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Replaces globalThis.fetch. Calls to the Telegram Bot API are recorded and
 * answered with `{ ok: true, result }`. Any other request goes to the real fetch.
 */
export function installTelegramStub(): TelegramStub {
  const original = globalThis.fetch;
  const calls: TelegramCall[] = [];
  const results = new Map<string, unknown>();
  const failures = new Map<string, InjectedError>();

  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const match = TELEGRAM_URL.exec(url);
    if (!match?.[1]) return original(input, init);
    const method = match[1];
    const payload = await readPayload(input, init);
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      calls.push({ method, payload, failed: true });
      return new Response(JSON.stringify({ ok: false, ...failure }), {
        status: failure.error_code,
        headers: { "content-type": "application/json" },
      });
    }
    calls.push({ method, payload });
    const result = results.has(method) ? results.get(method) : true;
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });
  };

  globalThis.fetch = stub as typeof fetch;

  return {
    calls,
    setResult: (method, result) => {
      results.set(method, result);
    },
    failNext: (method, error = { error_code: 500, description: "Internal Server Error: injected" }) => {
      failures.set(method, error);
    },
    callsTo: (method) => calls.filter((call) => call.method === method),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
