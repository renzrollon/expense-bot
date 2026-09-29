import { createGateway } from "./gateway";
import { modules } from "./modules";

const gateway = createGateway({ modules });

export default {
  fetch: gateway.fetch,
} satisfies ExportedHandler<Env>;
