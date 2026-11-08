import { z } from "zod";
import type { CodecksDisplay } from "./types";

/** The card details chips show until an admin turns them off. */
export const CodecksDisplayDefaults: CodecksDisplay = {
  effort: true,
  assignee: true,
};

/**
 * Reads which card details chips show from a Codecks integration's settings.
 * Missing or malformed values fall back to the defaults.
 *
 * @param settings the integration's settings.
 * @returns the display options.
 */
export function readCodecksDisplay(settings: unknown): CodecksDisplay {
  const parsed = DisplaySettingsSchema.safeParse(settings);
  const display = parsed.success ? parsed.data.codecks.display : undefined;
  return {
    effort: display?.effort ?? CodecksDisplayDefaults.effort,
    assignee: display?.assignee ?? CodecksDisplayDefaults.assignee,
  };
}

const Flag = z.boolean().optional().catch(undefined);

const DisplaySettingsSchema = z.object({
  codecks: z.object({
    display: z
      .object({ effort: Flag, assignee: Flag })
      .optional()
      .catch(undefined),
  }),
});
