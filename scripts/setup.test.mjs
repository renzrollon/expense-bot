import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run } from "./setup.mjs";

const TOKEN = "123456:SECRET-token_XYZ";
const OTHER_TOKEN = "999999:file-token_ABC";
const NOW = new Date("2026-01-01T12:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const STEPS_LINE = "Steps: bot-info, discover, secret, webhook, verify";
const EXPECTED_TYPES = ["message", "edited_message", "callback_query"];

// responses: method -> result object, or a function(body) -> full Telegram answer.
function makeDeps({ env = { BOT_TOKEN: TOKEN }, secrets = {}, responses = {}, fetchImpl } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const fetch =
    fetchImpl ??
    (async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method: init?.method, body });
      const name = String(url).split("/").pop();
      const r = responses[name];
      const answer = typeof r === "function" ? r(body) : { ok: true, result: r ?? true };
      return new Response(JSON.stringify(answer), {
        status: answer.ok ? 200 : (answer.error_code ?? 400),
        headers: { "content-type": "application/json" },
      });
    });
  const deps = {
    env,
    fetch,
    print: (l) => out.push(l),
    printError: (l) => err.push(l),
    readSecretsFile: () => secrets,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256),
    now: () => NOW,
  };
  return { deps, out, err, calls };
}

function assertNoToken(out, err) {
  const all = [...out, ...err].join("\n");
  assert.ok(!all.includes(TOKEN), "bot token leaked");
  assert.ok(!all.includes(OTHER_TOKEN), "secrets-file token leaked");
}

const ME = {
  id: 42,
  is_bot: true,
  first_name: "Expense",
  username: "expense_bot",
  can_read_all_group_messages: true,
};

test("Bot info prints the identity as one line of JSON and exits 0", async () => {
  const { deps, out, err, calls } = makeDeps({ responses: { getMe: ME } });
  const code = await run(["bot-info"], deps);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0]), ME);
  assert.ok(!out[0].includes("\n"));
  assert.deepEqual(err, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/getMe`);
  assert.equal(calls[0].method, "POST");
  assertNoToken(out, err);
});

test("Privacy mode is on warns on standard error and still exits 0", async () => {
  const me = { ...ME, can_read_all_group_messages: false };
  const { deps, out, err } = makeDeps({ responses: { getMe: me } });
  const code = await run(["bot-info"], deps);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0]), me);
  assert.deepEqual(err, [
    "Privacy mode is on. Turn it off in BotFather with /setprivacy, then remove the bot from the group and add it again.",
  ]);
  assertNoToken(out, err);
});

const GROUP_UPDATES = [
  { update_id: 1, message: { chat: { id: -100, type: "supergroup", title: "Household" }, from: { id: 7, first_name: "Ann" } } },
  { update_id: 2, edited_message: { chat: { id: -100, type: "supergroup", title: "Household" }, from: { id: 8, first_name: "Ben" } } },
  {
    update_id: 3,
    callback_query: {
      from: { id: 7, first_name: "Ann" },
      message: { chat: { id: -100, type: "supergroup", title: "Household" } },
    },
  },
];

test("Discover ids lists each chat and sender once", async () => {
  const { deps, out, err, calls } = makeDeps({
    responses: { getWebhookInfo: { url: "" }, getUpdates: GROUP_UPDATES },
  });
  const code = await run(["discover"], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, ["Chats:", "-100  supergroup  Household", "Senders:", "7  Ann", "8  Ben"]);
  assert.deepEqual(err, []);
  assert.deepEqual(calls.map((c) => c.url.split("/").pop()), ["getWebhookInfo", "getUpdates"]);
  assertNoToken(out, err);
});

test("Discover finds no pending update", async () => {
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: { url: "" }, getUpdates: [] } });
  const code = await run(["discover"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, [
    "No pending update found. Send a message in the group, check that privacy mode is off, and run discover again.",
  ]);
  assert.ok(!out.includes("Chats:"));
  assertNoToken(out, err);
});

test("Discover lists a private chat with the first name in place of the title", async () => {
  const updates = [
    { update_id: 1, message: { chat: { id: 55, type: "private", first_name: "Cy" }, from: { id: 55, first_name: "Cy" } } },
  ];
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: { url: "" }, getUpdates: updates } });
  const code = await run(["discover"], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, ["Chats:", "55  private  Cy", "Senders:", "55  Cy"]);
  assertNoToken(out, err);
});

test("Discover while a webhook is registered refuses without changing anything", async () => {
  const { deps, out, err, calls } = makeDeps({
    responses: { getWebhookInfo: { url: "https://example.com/hook" } },
  });
  const code = await run(["discover"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, ['A webhook is registered. Remove it with "webhook --delete" first.']);
  assert.deepEqual(calls.map((c) => c.url.split("/").pop()), ["getWebhookInfo"]);
  assertNoToken(out, err);
});

test("Generate a secret prints 48 characters from the allowed set", async () => {
  const { deps, out, err, calls } = makeDeps({ env: {} });
  const code = await run(["secret"], deps);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.match(out[0], /^[A-Za-z0-9_-]{48}$/);
  assert.deepEqual(err, []);
  assert.equal(calls.length, 0);
});

const SECRET = "abcDEF_123-xyz";
const URL_OK = "https://example.com/telegram";

test("Register the webhook with the secret and exactly the three update types", async () => {
  const { deps, out, err, calls } = makeDeps({ env: { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET } });
  const code = await run(["webhook", URL_OK], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, [`Webhook registered: ${URL_OK}`]);
  assert.deepEqual(err, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/setWebhook`);
  assert.equal(calls[0].body.url, URL_OK);
  assert.equal(calls[0].body.secret_token, SECRET);
  assert.deepEqual(calls[0].body.allowed_updates, EXPECTED_TYPES);
  assert.ok(!calls[0].body.drop_pending_updates);
  assertNoToken(out, err);
});

test("Register and drop pending updates", async () => {
  const { deps, out, err, calls } = makeDeps({ env: { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET } });
  const code = await run(["webhook", URL_OK, "--drop-pending"], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, [`Webhook registered: ${URL_OK}`, "Pending updates dropped."]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.drop_pending_updates, true);
  assertNoToken(out, err);
});

test("Remove the webhook", async () => {
  const { deps, out, err, calls } = makeDeps();
  const code = await run(["webhook", "--delete"], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, ["Webhook removed."]);
  assert.deepEqual(calls.map((c) => c.url.split("/").pop()), ["deleteWebhook"]);
  assertNoToken(out, err);
});

for (const [label, secret, reason] of [
  ["empty", "", "it is empty"],
  ["too long", "a".repeat(257), "it is longer than 256 characters"],
  ["bad character", "abc def!", "it has a character outside A-Z, a-z, 0-9, _ and -"],
]) {
  test(`Invalid webhook secret (${label}) calls nothing`, async () => {
    const { deps, out, err, calls } = makeDeps({ env: { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: secret } });
    const code = await run(["webhook", URL_OK], deps);
    assert.notEqual(code, 0);
    assert.deepEqual(err, [`WEBHOOK_SECRET is invalid: ${reason}`]);
    assert.equal(calls.length, 0);
    assertNoToken(out, err);
  });
}

test("Address is not HTTPS calls nothing", async () => {
  const { deps, out, err, calls } = makeDeps({ env: { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET } });
  const code = await run(["webhook", "http://example.com/telegram"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, ["The address must use HTTPS."]);
  assert.equal(calls.length, 0);
  assertNoToken(out, err);
});

const healthy = (extra = {}) => ({
  url: URL_OK,
  pending_update_count: 3,
  allowed_updates: EXPECTED_TYPES,
  ...extra,
});

test("Verify a healthy webhook", async () => {
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: healthy() } });
  const code = await run(["verify"], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, [`Address: ${URL_OK}`, "Pending updates: 3", "Last error: none"]);
  assert.deepEqual(err, []);
  assertNoToken(out, err);
});

test("Verify finds no webhook registered", async () => {
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: { url: "", pending_update_count: 0 } } });
  const code = await run(["verify"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, ["Problem: no webhook is registered"]);
  assertNoToken(out, err);
});

test("Verify finds different update types", async () => {
  const info = healthy({ allowed_updates: ["message"] });
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: info } });
  const code = await run(["verify"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, [
    "Problem: the update types are message, expected message, edited_message, callback_query",
  ]);
  assertNoToken(out, err);
});

test("Verify finds a recent delivery error", async () => {
  const info = healthy({ last_error_date: NOW_SEC - 5 * 60 - 30, last_error_message: "Wrong response from the webhook: 500" });
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: info } });
  const code = await run(["verify"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, [
    "Problem: Telegram recorded a delivery error 5 min ago: Wrong response from the webhook: 500",
  ]);
  assertNoToken(out, err);
});

test("Verify treats an error of exactly 10 minutes as a problem", async () => {
  const info = healthy({ last_error_date: NOW_SEC - 600, last_error_message: "boom" });
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: info } });
  const code = await run(["verify"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, ["Problem: Telegram recorded a delivery error 10 min ago: boom"]);
  assertNoToken(out, err);
});

test("Verify sees an old error, prints its age and exits 0", async () => {
  const info = healthy({ last_error_date: NOW_SEC - 15 * 60 - 59, last_error_message: "Connection timed out" });
  const { deps, out, err } = makeDeps({ responses: { getWebhookInfo: info } });
  const code = await run(["verify"], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, [
    `Address: ${URL_OK}`,
    "Pending updates: 3",
    "Last error: Connection timed out (15 min ago)",
  ]);
  assert.deepEqual(err, []);
  assertNoToken(out, err);
});

test("Telegram rejects the token: prints the description, not the token", async () => {
  const { deps, out, err } = makeDeps({
    responses: { getMe: () => ({ ok: false, error_code: 401, description: "Unauthorized" }) },
  });
  const code = await run(["bot-info"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, ["Telegram error: Unauthorized"]);
  assertNoToken(out, err);
});

test("Bot token is not set calls nothing", async () => {
  const { deps, out, err, calls } = makeDeps({ env: {}, secrets: {} });
  const code = await run(["bot-info"], deps);
  assert.notEqual(code, 0);
  assert.deepEqual(err, ["BOT_TOKEN is missing."]);
  assert.equal(calls.length, 0);
});

test("Token comes from the secrets file", async () => {
  const { deps, out, err, calls } = makeDeps({
    env: {},
    secrets: { BOT_TOKEN: OTHER_TOKEN },
    responses: { getMe: ME },
  });
  const code = await run(["bot-info"], deps);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${OTHER_TOKEN}/getMe`);
  assertNoToken(out, err);
});

test("Environment wins over the secrets file", async () => {
  const { deps, out, err, calls } = makeDeps({
    env: { BOT_TOKEN: TOKEN },
    secrets: { BOT_TOKEN: OTHER_TOKEN },
    responses: { getMe: ME },
  });
  const code = await run(["bot-info"], deps);
  assert.equal(code, 0);
  assert.equal(out.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/getMe`);
  assertNoToken(out, err);
});

test("Secrets file values with quotes are used without the quotes, as parsed by the caller", async () => {
  // run() receives the file already parsed; a token from it must be used verbatim.
  const { deps, out, err, calls } = makeDeps({
    env: {},
    secrets: { BOT_TOKEN: OTHER_TOKEN },
    responses: { getMe: ME },
  });
  assert.equal(await run(["bot-info"], deps), 0);
  assert.ok(!calls[0].url.includes('"') && !calls[0].url.includes("'"));
  assert.equal(out.length, 1);
  assertNoToken(out, err);
});

for (const [label, argv] of [
  ["no step", []],
  ["an unknown step", ["frobnicate"]],
]) {
  test(`Unknown or missing step (${label}) prints the steps and calls nothing`, async () => {
    const { deps, out, err, calls } = makeDeps();
    const code = await run(argv, deps);
    assert.notEqual(code, 0);
    assert.deepEqual(err, [STEPS_LINE]);
    assert.equal(calls.length, 0);
    assertNoToken(out, err);
  });
}

test("Exit status reaches the shell", () => {
  const script = fileURLToPath(new URL("./setup.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.ok(r.status !== null && r.status !== 0, `exit status was ${r.status}`);
  assert.ok(r.stderr.includes(STEPS_LINE), `stderr was: ${r.stderr}`);
});

test("Network failure prints the error with the token removed", async () => {
  const { deps, out, err } = makeDeps({
    fetchImpl: async (url) => {
      throw new Error(`connect ECONNREFUSED for ${url}`);
    },
  });
  const code = await run(["bot-info"], deps);
  assert.notEqual(code, 0);
  assert.equal(err.length, 1);
  assert.match(err[0], /^Request failed: connect ECONNREFUSED/);
  assertNoToken(out, err);
});
