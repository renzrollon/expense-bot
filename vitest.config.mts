import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import {
  ALLOWED_USER_IDS_TEXT,
  BOT_INFO,
  BOT_TOKEN,
  HOUSEHOLD_TZ,
  WEBHOOK_SECRET,
} from "./test/helpers/constants";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(`${import.meta.dirname}/migrations`);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            BOT_TOKEN,
            WEBHOOK_SECRET,
            BOT_INFO: JSON.stringify(BOT_INFO),
            ALLOWED_USER_IDS: ALLOWED_USER_IDS_TEXT,
            HOUSEHOLD_TZ,
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
