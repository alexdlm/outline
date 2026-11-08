import { randomUUID } from "node:crypto";
import {
  IntegrationService,
  IntegrationType,
  UnfurlResourceType,
  type IntegrationSettings,
} from "@shared/types";
import { Integration, IntegrationAuthentication } from "@server/models";
import {
  buildAdmin,
  buildApiKey,
  buildCollection,
  buildGuestUser,
  buildPersonalCollection,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { CacheHelper } from "@server/utils/CacheHelper";
import { RedisPrefixHelper } from "@server/utils/RedisPrefixHelper";
import type { CodecksAccount, CodecksMapping } from "../../shared/types";
import {
  Codecks,
  CodecksError,
  CodecksErrorCode,
  type CodecksCard,
} from "../codecks";

const server = getTestServer();

const token = "cdxat_valid";

const cardUrl = "https://acme.codecks.io/card/16a-document-how-things-work";

function buildAccount(overrides: Partial<CodecksAccount> = {}) {
  return { id: randomUUID(), name: "Acme", subdomain: "acme", ...overrides };
}

function buildCard(projectId: string): CodecksCard {
  return {
    cardId: randomUUID(),
    accountSeq: 150,
    title: "Document how things work",
    content: "Document how things work",
    status: "started",
    derivedStatus: null,
    priority: null,
    effort: null,
    isDoc: false,
    visibility: "default",
    childCount: 0,
    createdAt: null,
    lastUpdatedAt: null,
    assignee: null,
    parent: null,
    deck: null,
    project: { id: projectId, name: "Game" },
    milestone: null,
  };
}

async function buildConnectedTeam() {
  const team = await buildTeam();
  const admin = await buildAdmin({ teamId: team.id });
  const collection = await buildCollection({
    teamId: team.id,
    userId: admin.id,
  });
  const account = buildAccount();
  const mapping: CodecksMapping = {
    projectId: randomUUID(),
    projectName: "Game",
    collectionId: collection.id,
    defaultDeckId: null,
  };
  const authentication = await IntegrationAuthentication.create({
    service: IntegrationService.Codecks,
    userId: admin.id,
    teamId: team.id,
    token: "cdxat_previous",
  });
  const integration = await Integration.create<
    Integration<IntegrationType.Embed>
  >({
    service: IntegrationService.Codecks,
    type: IntegrationType.Embed,
    userId: admin.id,
    teamId: team.id,
    authenticationId: authentication.id,
    settings: { codecks: { account }, codecksMappings: [mapping] },
  });

  return { team, admin, collection, account, mapping, integration };
}

async function findCodecksIntegrations(teamId: string) {
  return Integration.findAll<Integration<IntegrationType.Embed>>({
    where: { service: IntegrationService.Codecks, teamId },
    include: [{ model: IntegrationAuthentication, as: "authentication" }],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#codecks.connect", () => {
  it("should connect an organization", async () => {
    const admin = await buildAdmin();
    const account = buildAccount();
    const getAccount = vi
      .spyOn(Codecks, "getAccount")
      .mockResolvedValue(account);

    const res = await server.post("/api/codecks.connect", admin, {
      body: { token, subdomain: "https://Acme.codecks.io/" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(getAccount).toHaveBeenCalledWith(token, "acme");
    expect(body.data).toEqual({
      integrationId: expect.any(String),
      account,
      mappings: [],
    });
    expect(JSON.stringify(body)).not.toContain(token);

    const integrations = await findCodecksIntegrations(admin.teamId);
    expect(integrations).toHaveLength(1);
    expect(integrations[0].id).toEqual(body.data.integrationId);
    expect(integrations[0].type).toEqual(IntegrationType.Embed);
    expect(integrations[0].authentication.token).toEqual(token);
    expect(integrations[0].settings).toEqual({
      codecks: { account },
      codecksMappings: [],
    });
  });

  it("should require an admin", async () => {
    const user = await buildUser();
    const getAccount = vi.spyOn(Codecks, "getAccount");

    const res = await server.post("/api/codecks.connect", user, {
      body: { token, subdomain: "acme" },
    });

    expect(res.status).toEqual(403);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("should not accept an API key", async () => {
    const admin = await buildAdmin();
    const apiKey = await buildApiKey({ userId: admin.id });
    const getAccount = vi.spyOn(Codecks, "getAccount");

    const res = await server.post("/api/codecks.connect", {
      headers: { authorization: `Bearer ${apiKey.value}` },
      body: { token, subdomain: "acme" },
    });

    expect(res.status).toEqual(403);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("should reject an invalid subdomain", async () => {
    const admin = await buildAdmin();
    const getAccount = vi.spyOn(Codecks, "getAccount");

    const res = await server.post("/api/codecks.connect", admin, {
      body: { token, subdomain: "acme.example.com" },
    });

    expect(res.status).toEqual(400);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("should reject a token that Codecks does not accept", async () => {
    const admin = await buildAdmin();
    vi.spyOn(Codecks, "getAccount").mockRejectedValue(
      new CodecksError(CodecksErrorCode.Unauthorized, 401)
    );

    const res = await server.post("/api/codecks.connect", admin, {
      body: { token, subdomain: "acme" },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toEqual(
      new CodecksError(CodecksErrorCode.Unauthorized).message
    );
    expect(await findCodecksIntegrations(admin.teamId)).toHaveLength(0);
  });

  it("should replace the token of an existing connection in place", async () => {
    const { team, admin, account, mapping, integration } =
      await buildConnectedTeam();
    vi.spyOn(Codecks, "getAccount").mockResolvedValue(
      buildAccount({ id: account.id, name: "Acme Renamed" })
    );

    const res = await server.post("/api/codecks.connect", admin, {
      body: { token, subdomain: "acme" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.integrationId).toEqual(integration.id);
    expect(body.data.mappings).toEqual([mapping]);

    const integrations = await findCodecksIntegrations(team.id);
    expect(integrations).toHaveLength(1);
    expect(integrations[0].authenticationId).toEqual(
      integration.authenticationId
    );
    expect(integrations[0].authentication.token).toEqual(token);
    expect(integrations[0].settings.codecks?.account.name).toEqual(
      "Acme Renamed"
    );
    expect(integrations[0].settings.codecksMappings).toEqual([mapping]);
  });

  it("should reset the mappings when the organization changes", async () => {
    const { team, admin, integration } = await buildConnectedTeam();
    const other = buildAccount({ subdomain: "other" });
    vi.spyOn(Codecks, "getAccount").mockResolvedValue(other);

    const res = await server.post("/api/codecks.connect", admin, {
      body: { token, subdomain: "other" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual({
      integrationId: integration.id,
      account: other,
      mappings: [],
    });

    const integrations = await findCodecksIntegrations(team.id);
    expect(integrations[0].settings).toEqual({
      codecks: { account: other },
      codecksMappings: [],
    });
  });

  it("should clear the team's cached unfurls", async () => {
    const { team, admin, account } = await buildConnectedTeam();
    const key = `${RedisPrefixHelper.getUnfurlPrefix(team.id)}codecks:${account.id}:1`;
    await CacheHelper.setData(key, { cached: true }, 60);
    vi.spyOn(Codecks, "getAccount").mockResolvedValue(account);

    const res = await server.post("/api/codecks.connect", admin, {
      body: { token, subdomain: "acme" },
    });

    expect(res.status).toEqual(200);
    await expect(CacheHelper.getData(key)).resolves.toBeUndefined();
  });
});

describe("#codecks.info", () => {
  it("should return the connection with its mappings", async () => {
    const { admin, account, mapping, integration } = await buildConnectedTeam();

    const res = await server.post("/api/codecks.info", admin);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual({
      integrationId: integration.id,
      account,
      mappings: [mapping],
    });
  });

  it("should return null when not connected", async () => {
    const admin = await buildAdmin();

    const res = await server.post("/api/codecks.info", admin);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toBeNull();
  });

  it("should require an admin", async () => {
    const { team } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });

    const res = await server.post("/api/codecks.info", user);

    expect(res.status).toEqual(403);
  });
});

describe("#codecks.projects", () => {
  it("should list projects with the stored token", async () => {
    const { admin, account } = await buildConnectedTeam();
    const projects = [
      {
        id: randomUUID(),
        name: "Game",
        decks: [{ id: randomUUID(), title: "Backlog", coverColor: null }],
      },
    ];
    const list = vi
      .spyOn(Codecks, "listProjectsWithDecks")
      .mockResolvedValue(projects);

    const res = await server.post("/api/codecks.projects", admin);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual(projects);
    expect(list).toHaveBeenCalledWith({
      token: "cdxat_previous",
      subdomain: account.subdomain,
      accountId: account.id,
    });
  });

  it("should return a fixed message when Codecks fails", async () => {
    const { admin } = await buildConnectedTeam();
    vi.spyOn(Codecks, "listProjectsWithDecks").mockRejectedValue(
      new Error("upstream detail")
    );

    const res = await server.post("/api/codecks.projects", admin);
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).not.toContain("upstream detail");
  });

  it("should require an admin", async () => {
    const { team } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const list = vi.spyOn(Codecks, "listProjectsWithDecks");

    const res = await server.post("/api/codecks.projects", user);

    expect(res.status).toEqual(403);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("#codecks.update", () => {
  it("should replace the mappings", async () => {
    const { team, admin, account, integration } = await buildConnectedTeam();
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const mappings: CodecksMapping[] = [
      {
        projectId: "project-1",
        projectName: "Game",
        collectionId: privateCollection.id,
        defaultDeckId: "deck-1",
      },
    ];

    const res = await server.post("/api/codecks.update", admin, {
      body: { mappings: [...mappings, ...mappings] },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual({
      integrationId: integration.id,
      account,
      mappings,
    });

    await integration.reload();
    expect(integration.settings).toEqual({
      codecks: { account },
      codecksMappings: mappings,
    });
  });

  it("should stop presenting cards of a project that is no longer mapped", async () => {
    const { team, admin, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    vi.spyOn(Codecks, "getCardsBySeq").mockResolvedValue([
      buildCard(mapping.projectId),
    ]);
    await expect(Codecks.unfurl(cardUrl, user)).resolves.toMatchObject({
      type: UnfurlResourceType.Issue,
    });

    const res = await server.post("/api/codecks.update", admin, {
      body: { mappings: [{ ...mapping, projectId: randomUUID() }] },
    });

    expect(res.status).toEqual(200);
    await expect(Codecks.unfurl(cardUrl, user)).resolves.toEqual({
      error: expect.any(String),
      cacheExpiry: 15,
    });
  });

  it("should reject a collection of another team", async () => {
    const { admin, integration, mapping } = await buildConnectedTeam();
    const collection = await buildCollection();

    const res = await server.post("/api/codecks.update", admin, {
      body: {
        mappings: [{ ...mapping, collectionId: collection.id }],
      },
    });

    expect(res.status).toEqual(400);
    await integration.reload();
    expect(integration.settings.codecksMappings).toEqual([mapping]);
  });

  it("should reject a personal collection", async () => {
    const { admin, mapping } = await buildConnectedTeam();
    const collection = await buildPersonalCollection(admin);

    const res = await server.post("/api/codecks.update", admin, {
      body: {
        mappings: [{ ...mapping, collectionId: collection.id }],
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should reject an archived collection", async () => {
    const { team, admin, mapping } = await buildConnectedTeam();
    const collection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      archivedAt: new Date(),
    });

    const res = await server.post("/api/codecks.update", admin, {
      body: {
        mappings: [{ ...mapping, collectionId: collection.id }],
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should require a connection", async () => {
    const admin = await buildAdmin();

    const res = await server.post("/api/codecks.update", admin, {
      body: { mappings: [] },
    });

    expect(res.status).toEqual(404);
  });

  it("should require an admin", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });

    const res = await server.post("/api/codecks.update", user, {
      body: { mappings: [mapping] },
    });

    expect(res.status).toEqual(403);
  });
});

describe("#integrations.list", () => {
  function codecksSettings(body: {
    data: Array<{
      service: string;
      settings: IntegrationSettings<IntegrationType.Embed>;
    }>;
  }) {
    return body.data.find(
      (integration) => integration.service === IntegrationService.Codecks
    )?.settings;
  }

  it("should present the organization to members but never the mappings", async () => {
    const { team, account } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });

    const res = await server.post("/api/integrations.list", user);
    const settings = codecksSettings(await res.json());

    expect(res.status).toEqual(200);
    expect(settings?.codecks).toEqual({ account });
    expect(settings).not.toHaveProperty("codecksMappings");
  });

  it("should not present the organization to guests", async () => {
    const { team } = await buildConnectedTeam();
    const guest = await buildGuestUser({ teamId: team.id });

    const res = await server.post("/api/integrations.list", guest);
    const settings = codecksSettings(await res.json());

    expect(res.status).toEqual(200);
    expect(settings).toBeDefined();
    expect(settings).not.toHaveProperty("codecks");
    expect(settings).not.toHaveProperty("codecksMappings");
  });
});
