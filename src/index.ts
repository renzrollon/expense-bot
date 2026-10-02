import { createGateway } from "./gateway";
import { modules } from "./modules";
import { createScheduler } from "./scheduler";

const gateway = createGateway({ modules });
const scheduler = createScheduler({ registry: gateway.registry });

export default {
  fetch: gateway.fetch,
  scheduled: scheduler.scheduled,
} satisfies ExportedHandler<Env>;
