export const BOT_TOKEN = "123456:test-token";
export const WEBHOOK_SECRET = "test-webhook-secret";
export const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
export const HOUSEHOLD_TZ = "Asia/Manila";

export const BOT_USERNAME = "expense_test_bot";
export const BOT_INFO = {
  id: 424242,
  is_bot: true as const,
  first_name: "Expense Test Bot",
  username: BOT_USERNAME,
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export const MEMBER_A = { id: 1001, firstName: "Ana", username: "ana" };
export const MEMBER_B = { id: 1002, firstName: "Ben", username: "ben" };
export const ALLOWED_USER_IDS_TEXT = JSON.stringify([MEMBER_A.id, MEMBER_B.id]);
export const ALLOWED_CHAT_ID = -1001234567890;
