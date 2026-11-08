import { z } from "zod";
import { Collection } from "@server/models";
import type { Integration, User } from "@server/models";
import { can } from "@server/policies";
import type { CodecksAccount, CodecksMapping } from "../shared/types";

/** A Codecks organization as stored in the integration settings. */
export const CodecksAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  subdomain: z.string().regex(/^[a-z0-9-]{1,63}$/),
});

/** A project to collection mapping as stored in the integration settings. */
export const CodecksMappingSchema = z.object({
  projectId: z.string().min(1).max(100),
  projectName: z.string().max(255),
  collectionId: z.uuid(),
  defaultDeckId: z.string().min(1).max(100).nullable(),
});

/**
 * Reads the connected Codecks organization from an integration.
 *
 * @param integration the Codecks integration.
 * @returns the organization, or undefined if the settings are missing or malformed.
 */
export function getCodecksAccount(
  integration: Integration
): CodecksAccount | undefined {
  const parsed = AccountSettingsSchema.safeParse(integration.settings);
  return parsed.success ? parsed.data.codecks.account : undefined;
}

/**
 * Reads the project to collection mappings from an integration.
 *
 * @param integration the Codecks integration.
 * @returns the mappings, or undefined if they are missing or malformed.
 */
export function getCodecksMappings(
  integration: Integration
): CodecksMapping[] | undefined {
  const parsed = MappingSettingsSchema.safeParse(integration.settings);
  return parsed.success ? parsed.data.codecksMappings : undefined;
}

/**
 * Returns the Codecks projects whose cards a user may see. A project is
 * allowed when it is mapped to an active collection the user can read. Guests,
 * users of other teams and malformed settings get no projects.
 *
 * @param actor the user viewing cards.
 * @param integration the team's Codecks integration.
 * @returns the IDs of the allowed projects.
 */
export async function allowedProjectIds(
  actor: User,
  integration: Integration
): Promise<Set<string>> {
  if (actor.isGuest || actor.teamId !== integration.teamId) {
    return new Set();
  }

  const mappings = getCodecksMappings(integration);
  if (!mappings?.length) {
    return new Set();
  }

  const collectionIds = [...new Set(mappings.map((m) => m.collectionId))];
  const collections = await Collection.scope([
    "defaultScope",
    { method: ["withMembership", actor.id] },
  ]).findAll({
    where: { id: collectionIds, teamId: actor.teamId },
  });

  const readable = new Set(
    collections
      .filter(
        (collection) => collection.isActive && can(actor, "read", collection)
      )
      .map((collection) => collection.id)
  );

  return new Set(
    mappings
      .filter((mapping) => readable.has(mapping.collectionId))
      .map((mapping) => mapping.projectId)
  );
}

const AccountSettingsSchema = z.object({
  codecks: z.object({ account: CodecksAccountSchema }),
});

const MappingSettingsSchema = z.object({
  codecksMappings: z.array(CodecksMappingSchema),
});
