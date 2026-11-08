import Router from "@koa/router";
import type { Transaction } from "sequelize";
import { IntegrationService, IntegrationType, UserRole } from "@shared/types";
import { toError } from "@shared/utils/error";
import { NotFoundError, ValidationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Collection,
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
import type { CodecksMapping } from "../../shared/types";
import { Codecks, CodecksError } from "../codecks";
import { getCodecksAccount, getCodecksMappings } from "../gate";
import { presentInfo } from "../presenters";
import * as T from "./schema";

/** The routes that admins use to connect Codecks and map its projects. */
export const router = new Router();

router.post(
  "codecks.connect",
  rateLimiter(RateLimiterStrategy.TenPerMinute),
  auth({ role: UserRole.Admin, type: AuthenticationType.APP }),
  validate(T.CodecksConnectSchema),
  transaction(),
  async (ctx: APIContext<T.CodecksConnectReq>) => {
    const { token, subdomain } = ctx.input.body;
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
        codecks: { account },
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
    const { mappings } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    await LockHelper.acquire(sequelize, lockName(user.teamId), transaction);
    const integration = await findIntegration(user.teamId, transaction);
    const account = integration ? getCodecksAccount(integration) : undefined;
    if (!integration || !account) {
      throw NotFoundError("Codecks is not connected.");
    }

    authorize(user, "update", integration);

    await assertMappableCollections(
      user,
      mappings.map((mapping) => mapping.collectionId),
      transaction
    );

    integration.settings = {
      ...integration.settings,
      codecks: { account },
      codecksMappings: uniqueMappings(mappings),
    };
    await integration.saveWithCtx(ctx);

    clearUnfurlsAfterCommit(transaction, user.teamId);

    ctx.body = {
      data: presentInfo(integration, account),
    };
  }
);

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
