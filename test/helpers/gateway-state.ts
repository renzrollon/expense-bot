import { env } from "cloudflare:workers";
import type { GatewayState } from "../../src/gateway/bot";
import { buildRegistry, type FeatureModule } from "../../src/gateway/registry";
import { ALLOWED_CHAT_ID, MEMBER_A } from "./constants";

/**
 * The state that buildBot takes. The registry comes from buildRegistry(modules)
 * and the database from env. It does not go through createGateway or readConfig.
 */
export function gatewayState(
  modules: FeatureModule[],
  overrides: Partial<GatewayState> = {},
): GatewayState {
  return {
    env,
    db: env.DB,
    now: new Date("2026-09-29T00:00:00.000Z"),
    timezone: env.HOUSEHOLD_TZ,
    chatId: ALLOWED_CHAT_ID,
    member: { userId: MEMBER_A.id, displayName: MEMBER_A.firstName },
    registry: buildRegistry(modules),
    ...overrides,
  };
}
