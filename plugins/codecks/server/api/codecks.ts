import Router from "@koa/router";
import type { Transaction } from "sequelize";
import { IntegrationService, IntegrationType, UserRole } from "@shared/types";
import { toError } from "@shared/utils/error";
import { Minute } from "@shared/utils/time";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Collection,
  Document,
  Integration,
  IntegrationAuthentication,
} from "@server/models";
import type { User } from "@server/models";
import { authorize, can } from "@server/policies";
import { sequelize } from "@server/storage/database";
import { LockHelper } from "@server/storage/LockHelper";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import { CacheHelper } from "@server/utils/CacheHelper";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { RedisPrefixHelper } from "@server/utils/RedisPrefixHelper";
import { readCodecksDisplay } from "../../shared/display";
import type { CodecksMapping } from "../../shared/types";
import { Codecks, CodecksError } from "../codecks";
import type { CodecksCard, CodecksConnection } from "../codecks";
import {
  allowedProjectIds,
  getCodecksAccount,
  getCodecksMappings,
} from "../gate";
import { presentCard, presentInfo } from "../presenters";
import * as T from "./schema";

/**
 * The routes that admins use to connect Codecks and map its projects, and that
 * members use to search the cards they may mention.
 */
export const router = new Router();

router.post(
  "codecks.connect",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth({ role: UserRole.Admin, type: AuthenticationType.APP }),
  validate(T.CodecksConnectSchema),
  transaction(),
  async (ctx: APIContext<T.CodecksConnectReq>) => {
    const { apiToken: token, subdomain } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    authorize(user, "createIntegration", user.team);

    // Validated before the lock is taken, so it is never held during the request.
    const account = await Codecks.getAccount(token, subdomain).catch(
      (err: unknown) => {
        throw toRequestError(err);
      }
    );

    await LockHelper.acquire(sequelize, lockName(user.teamId), transaction);
    const existing = await findIntegration(user.teamId, transaction);

    let integration: Integration<IntegrationType.Embed>;
    if (existing) {
      authorize(user, "update", existing);

      if (existing.authentication) {
        existing.authentication.token = token;
        await existing.authentication.save({ transaction });
      } else {
        const authentication = await IntegrationAuthentication.create(
          {
            service: IntegrationService.Codecks,
            userId: user.id,
            teamId: user.teamId,
            token,
          },
          { transaction }
        );
        existing.authenticationId = authentication.id;
      }

      // Mappings refer to projects of the previous organization.
      const sameAccount = getCodecksAccount(existing)?.id === account.id;
      existing.settings = {
        codecks: { account, display: readCodecksDisplay(existing.settings) },
        codecksMappings: sameAccount
          ? (getCodecksMappings(existing) ?? [])
          : [],
      };
      integration = await existing.saveWithCtx(ctx);
    } else {
      const authentication = await IntegrationAuthentication.create(
        {
          service: IntegrationService.Codecks,
          userId: user.id,
          teamId: user.teamId,
          token,
        },
        { transaction }
      );
      integration = await Integration.createWithCtx<
        Integration<IntegrationType.Embed>
      >(ctx, {
        service: IntegrationService.Codecks,
        type: IntegrationType.Embed,
        userId: user.id,
        teamId: user.teamId,
        authenticationId: authentication.id,
        settings: { codecks: { account }, codecksMappings: [] },
      });
    }

    clearUnfurlsAfterCommit(transaction, user.teamId);

    ctx.body = {
      data: presentInfo(integration, account),
    };
  }
);

router.post(
  "codecks.info",
  auth({ role: UserRole.Admin }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;

    const integration = await findIntegration(user.teamId);
    const account = integration ? getCodecksAccount(integration) : undefined;
    if (!integration || !account) {
      ctx.body = { data: null };
      return;
    }

    authorize(user, "read", integration);

    ctx.body = {
      data: presentInfo(integration, account),
    };
  }
);

router.post(
  "codecks.projects",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth({ role: UserRole.Admin }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;

    const integration = await findIntegration(user.teamId);
    const account = integration ? getCodecksAccount(integration) : undefined;
    const token = integration?.authentication?.token;
    if (!integration || !account || !token) {
      throw NotFoundError("Codecks is not connected.");
    }

    authorize(user, "update", integration);

    const projects = await Codecks.listProjectsWithDecks({
      token,
      subdomain: account.subdomain,
      accountId: account.id,
    }).catch((err: unknown) => {
      throw toRequestError(err);
    });

    ctx.body = {
      data: projects,
    };
  }
);

router.post(
  "codecks.update",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth({ role: UserRole.Admin }),
  validate(T.CodecksUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.CodecksUpdateReq>) => {
    const { mappings, display } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    await LockHelper.acquire(sequelize, lockName(user.teamId), transaction);
    const integration = await findIntegration(user.teamId, transaction);
    const account = integration ? getCodecksAccount(integration) : undefined;
    if (!integration || !account) {
      throw NotFoundError("Codecks is not connected.");
    }

    authorize(user, "update", integration);

    if (mappings) {
      await assertMappableCollections(
        user,
        mappings.map((mapping) => mapping.collectionId),
        transaction
      );
    }

    integration.settings = {
      ...integration.settings,
      codecks: {
        account,
        display: { ...readCodecksDisplay(integration.settings), ...display },
      },
      codecksMappings: mappings
        ? uniqueMappings(mappings)
        : (getCodecksMappings(integration) ?? []),
    };
    await integration.saveWithCtx(ctx);

    clearUnfurlsAfterCommit(transaction, user.teamId);

    ctx.body = {
      data: presentInfo(integration, account),
    };
  }
);

router.post(
  "codecks.search",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  validate(T.CodecksSearchSchema),
  async (ctx: APIContext<T.CodecksSearchReq>) => {
    const { query, documentId } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (user.isGuest) {
      throw AuthorizationError("Guests cannot search Codecks cards.");
    }

    let document: Document | undefined;
    if (documentId) {
      const found = await Document.findByPk(documentId, {
        userId: user.id,
        includeViews: false,
        includeContent: false,
      });
      authorize(user, "read", found);
      document = found;
    }

    const integration = await findIntegration(user.teamId);
    const account = integration ? getCodecksAccount(integration) : undefined;
    const token = integration?.authentication?.token;
    if (!integration || !account || !token) {
      ctx.body = { data: [] };
      return;
    }

    let projectIds = await allowedProjectIds(user, integration);
    if (document) {
      projectIds = narrowToCollection(
        integration,
        projectIds,
        document.collectionId
      );
    }
    if (projectIds.size === 0) {
      ctx.body = { data: [] };
      return;
    }

    const connection = {
      token,
      subdomain: account.subdomain,
      accountId: account.id,
    };

    let cards: CodecksCard[] = [];
    try {
      const deckIds = await findDeckIds(user.teamId, connection, projectIds);
      if (deckIds.length > 0) {
        cards = await Codecks.searchCards(connection, {
          deckIds,
          query,
          limit: SearchLimit,
        });
      }
    } catch (err) {
      throw toRequestError(err);
    }

    ctx.body = {
      data: cards
        .filter((card) => !!card.project && projectIds.has(card.project.id))
        .map((card) => presentCard(card, account.subdomain)),
    };
  }
);

/** The most cards a search returns. */
const SearchLimit = 10;

function lockName(teamId: string) {
  return `integrations:codecks:${teamId}`;
}

function findIntegration(teamId: string, transaction?: Transaction) {
  return Integration.findOne<Integration<IntegrationType.Embed>>({
    where: {
      service: IntegrationService.Codecks,
      type: IntegrationType.Embed,
      teamId,
    },
    include: [
      {
        model: IntegrationAuthentication,
        as: "authentication",
        required: false,
      },
    ],
    order: [["createdAt", "ASC"]],
    transaction,
  });
}

/**
 * Checks that projects may be mapped to the collections: each must be an
 * active, non-personal collection of the user's team that the user can read.
 *
 * @param user the admin saving the mappings.
 * @param collectionIds the collections to check.
 * @param transaction the transaction to read in.
 * @throws ValidationError if any collection does not qualify.
 */
async function assertMappableCollections(
  user: User,
  collectionIds: string[],
  transaction: Transaction
) {
  const ids = [...new Set(collectionIds)];
  if (ids.length === 0) {
    return;
  }

  const collections = await Collection.scope([
    "defaultScope",
    { method: ["withMembership", user.id] },
  ]).findAll({ where: { id: ids }, transaction });
  const byId = new Map(collections.map((c) => [c.id, c]));

  for (const id of ids) {
    const collection = byId.get(id);
    if (
      !collection ||
      collection.teamId !== user.teamId ||
      !collection.isActive ||
      collection.isPersonal ||
      !can(user, "read", collection)
    ) {
      throw ValidationError(
        "Each project must be mapped to an active, non-personal collection in this workspace."
      );
    }
  }
}

/**
 * Narrows projects to those mapped to a collection. When nothing is mapped to
 * the collection the projects are returned unchanged, they are never widened.
 *
 * @param integration the Codecks integration.
 * @param projectIds the projects the user may see.
 * @param collectionId the collection, if any.
 * @returns the projects to search.
 */
function narrowToCollection(
  integration: Integration,
  projectIds: Set<string>,
  collectionId: string | null | undefined
): Set<string> {
  const mapped = (getCodecksMappings(integration) ?? []).filter(
    (mapping) => mapping.collectionId === collectionId
  );
  if (mapped.length === 0) {
    return projectIds;
  }
  return new Set(
    mapped
      .map((mapping) => mapping.projectId)
      .filter((projectId) => projectIds.has(projectId))
  );
}

/**
 * Finds the decks of projects. The organization's decks are cached with the
 * team's unfurls, so that most searches make a single request to Codecks.
 *
 * @param teamId the team.
 * @param connection the token and organization to query.
 * @param projectIds the projects.
 * @returns the IDs of the projects' decks.
 * @throws CodecksError if the decks could not be loaded.
 */
async function findDeckIds(
  teamId: string,
  connection: CodecksConnection & { accountId: string },
  projectIds: Set<string>
): Promise<string[]> {
  const projects = await CacheHelper.getDataOrSet<ProjectDecks[]>(
    `${RedisPrefixHelper.getUnfurlPrefix(teamId)}codecks:${connection.accountId}:decks`,
    async () =>
      (await Codecks.listProjectsWithDecks(connection)).map((project) => ({
        id: project.id,
        deckIds: project.decks.map((deck) => deck.id),
      })),
    DeckCacheExpiry
  );

  return (projects ?? [])
    .filter((project) => projectIds.has(project.id))
    .flatMap((project) => project.deckIds);
}

interface ProjectDecks {
  id: string;
  deckIds: string[];
}

/** How long the decks of an organization are cached, in seconds. */
const DeckCacheExpiry = Minute.seconds;

function uniqueMappings(mappings: CodecksMapping[]): CodecksMapping[] {
  const seen = new Set<string>();
  return mappings.filter((mapping) => {
    const key = `${mapping.projectId}:${mapping.collectionId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Clears the team's cached unfurls, including cards, once the transaction
 * commits. A failure is logged and does not fail the request.
 *
 * @param transaction the transaction that changes the connection.
 * @param teamId the team.
 */
function clearUnfurlsAfterCommit(transaction: Transaction, teamId: string) {
  transaction.afterCommit(async () => {
    try {
      await CacheHelper.clearData(RedisPrefixHelper.getUnfurlPrefix(teamId));
    } catch (err) {
      Logger.error("Failed to clear Codecks unfurls", toError(err));
    }
  });
}

function toRequestError(err: unknown) {
  if (err instanceof CodecksError) {
    return ValidationError(err.message);
  }
  Logger.error("Codecks request failed", toError(err));
  return ValidationError("Codecks could not be reached. Try again later.");
}
