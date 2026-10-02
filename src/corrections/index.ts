import type { FeatureModule } from "../gateway/registry";
import { handleEdited } from "./edited";
import { pressBack, pressCategory, pressRestore, pressSelect, pressUndo } from "./presses";
import { handleUndo } from "./undo";

/**
 * The `corrections` module (design Decisions 6 to 10). It only assembles the
 * registrations, and registers no handler for new messages, so capture stays
 * the last and only one.
 */
export const corrections: FeatureModule = {
  name: "corrections",
  commands: [{ name: "undo", description: "remove your last entry", handle: (ctx) => handleUndo(ctx) }],
  callbacks: [
    { prefix: "c", handle: pressCategory },
    { prefix: "s", handle: pressSelect },
    { prefix: "u", handle: pressUndo },
    { prefix: "r", handle: pressRestore },
    { prefix: "b", handle: pressBack },
  ],
  editedMessages: [handleEdited],
};
