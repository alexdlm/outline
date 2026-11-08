import { randomUUID } from "node:crypto";
import { CSRF } from "@shared/constants";
import {
  CollectionPermission,
  DocumentPermission,
  IntegrationService,
  IntegrationType,
  UnfurlResourceType,
  type IntegrationSettings,
} from "@shared/types";
import {
  Integration,
  IntegrationAuthentication,
  UserMembership,
} from "@server/models";
import {
  buildAdmin,
  buildApiKey,
  buildCollection,
  buildDocument,
  buildGuestUser,
  buildPersonalCollection,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { CacheHelper } from "@server/utils/CacheHelper";
import { RedisPrefixHelper } from "@server/utils/RedisPrefixHelper";
import env from "@server/env";
import { bundleToken, generateRawToken } from "@server/utils/csrf";
import type { CodecksAccount, CodecksMapping } from "../../shared/types";
import {
  Codecks,
  CodecksError,
  CodecksErrorCode,
  type CodecksCard,
} from "../codecks";
import { presentCard } from "../presenters";

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
      body: { apiToken: token, subdomain: "https://Acme.codecks.io/" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(getAccount).toHaveBeenCalledWith(token, "acme");
    expect(body.data).toEqual({
      integrationId: expect.any(String),
      account,
      mappings: [],
      display: { effort: true, assignee: true },
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

  it("should connect from a browser session", async () => {
    const admin = await buildAdmin();
    vi.spyOn(Codecks, "getAccount").mockResolvedValue(buildAccount());

    // Browsers authenticate with the session cookie, which a "token" in the
    // body would take precedence over.
    const csrfToken = bundleToken(generateRawToken(16), env.SECRET_KEY);
    const res = await server.post("/api/codecks.connect", {
      headers: {
        Cookie: `accessToken=${admin.getSessionToken()}; ${CSRF.cookieName}=${csrfToken}`,
        [CSRF.headerName]: csrfToken,
      },
      body: { apiToken: token, subdomain: "acme" },
    });

    expect(res.status).toEqual(200);
  });

  it("should require an admin", async () => {
    const user = await buildUser();
    const getAccount = vi.spyOn(Codecks, "getAccount");

    const res = await server.post("/api/codecks.connect", user, {
      body: { apiToken: token, subdomain: "acme" },
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
      body: { apiToken: token, subdomain: "acme" },
    });

    expect(res.status).toEqual(403);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("should reject an invalid subdomain", async () => {
    const admin = await buildAdmin();
    const getAccount = vi.spyOn(Codecks, "getAccount");

    const res = await server.post("/api/codecks.connect", admin, {
      body: { apiToken: token, subdomain: "acme.example.com" },
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
      body: { apiToken: token, subdomain: "acme" },
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
      body: { apiToken: token, subdomain: "acme" },
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
      body: { apiToken: token, subdomain: "other" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual({
      integrationId: integration.id,
      account: other,
      mappings: [],
      display: { effort: true, assignee: true },
    });

    const integrations = await findCodecksIntegrations(team.id);
    expect(integrations[0].settings).toEqual({
      codecks: { account: other, display: { effort: true, assignee: true } },
      codecksMappings: [],
    });
  });

  it("should clear the team's cached unfurls", async () => {
    const { team, admin, account } = await buildConnectedTeam();
    const key = `${RedisPrefixHelper.getUnfurlPrefix(team.id)}codecks:${account.id}:1`;
    await CacheHelper.setData(key, { cached: true }, 60);
    vi.spyOn(Codecks, "getAccount").mockResolvedValue(account);

    const res = await server.post("/api/codecks.connect", admin, {
      body: { apiToken: token, subdomain: "acme" },
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
      display: { effort: true, assignee: true },
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
      display: { effort: true, assignee: true },
    });

    await integration.reload();
    expect(integration.settings).toEqual({
      codecks: { account, display: { effort: true, assignee: true } },
      codecksMappings: mappings,
    });
  });

  it("should update the display options without changing the mappings", async () => {
    const { admin, integration, mapping } = await buildConnectedTeam();

    let res = await server.post("/api/codecks.update", admin, {
      body: { display: { effort: false } },
    });
    expect(res.status).toEqual(200);
    expect((await res.json()).data.display).toEqual({
      effort: false,
      assignee: true,
    });

    res = await server.post("/api/codecks.update", admin, {
      body: { display: { assignee: false } },
    });
    expect((await res.json()).data.display).toEqual({
      effort: false,
      assignee: false,
    });

    await integration.reload();
    expect(integration.settings?.codecks?.display).toEqual({
      effort: false,
      assignee: false,
    });
    expect(integration.settings?.codecksMappings).toEqual([mapping]);
  });

  it("should require mappings or display options", async () => {
    const { admin } = await buildConnectedTeam();

    const res = await server.post("/api/codecks.update", admin, {
      body: {},
    });

    expect(res.status).toEqual(400);
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

  it("should present the display options to members", async () => {
    const { team, account, integration } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    integration.settings = {
      ...integration.settings,
      codecks: { account, display: { effort: false, assignee: true } },
    };
    await integration.save();

    const res = await server.post("/api/integrations.list", user);
    const settings = codecksSettings(await res.json());

    expect(settings?.codecks?.display).toEqual({
      effort: false,
      assignee: true,
    });
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

describe("#codecks.search", () => {
  const recent = { $order: "-lastUpdatedAt", $limit: 10 };

  function mockDecks(decks: Record<string, string[]>) {
    return vi.spyOn(Codecks, "listProjectsWithDecks").mockResolvedValue(
      Object.entries(decks).map(([id, deckIds]) => ({
        id,
        name: "Project",
        decks: deckIds.map((deckId) => ({
          id: deckId,
          title: deckId,
          coverColor: null,
        })),
      }))
    );
  }

  function cardsKey(filter: object) {
    return `cards(${JSON.stringify(filter)})`;
  }

  it("should require authentication", async () => {
    const res = await server.post("/api/codecks.search", {
      body: { query: "" },
    });

    expect(res.status).toEqual(401);
  });

  it("should not allow guests", async () => {
    const { team, collection } = await buildConnectedTeam();
    const guest = await buildGuestUser({ teamId: team.id });
    await UserMembership.create({
      createdById: guest.id,
      collectionId: collection.id,
      userId: guest.id,
      permission: CollectionPermission.Read,
    });
    const search = vi.spyOn(Codecks, "searchCards");

    const res = await server.post("/api/codecks.search", guest, {
      body: { query: "" },
    });

    expect(res.status).toEqual(403);
    expect(search).not.toHaveBeenCalled();
  });

  it("should find nothing when Codecks is not connected", async () => {
    const user = await buildUser();
    const list = vi.spyOn(Codecks, "listProjectsWithDecks");
    const search = vi.spyOn(Codecks, "searchCards");

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("should present the matching cards", async () => {
    const { team, account, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const card = buildCard(mapping.projectId);
    mockDecks({ [mapping.projectId]: ["deck-1", "deck-2"] });
    const search = vi.spyOn(Codecks, "searchCards").mockResolvedValue([card]);

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "  document  " },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual([presentCard(card, account.subdomain)]);
    expect(body.data[0]).toMatchObject({
      type: UnfurlResourceType.Issue,
      url: cardUrl,
      id: "$16a",
      codecks: { shortId: "16a", project: { id: mapping.projectId } },
    });
    expect(search).toHaveBeenCalledWith(
      {
        token: "cdxat_previous",
        subdomain: account.subdomain,
        accountId: account.id,
      },
      { deckIds: ["deck-1", "deck-2"], query: "document", limit: 10 }
    );
  });

  it("should only search projects of collections the user can read", async () => {
    const { team, admin, account, mapping, integration } =
      await buildConnectedTeam();
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const secret: CodecksMapping = {
      projectId: randomUUID(),
      projectName: "Secret",
      collectionId: privateCollection.id,
      defaultDeckId: null,
    };
    integration.settings = {
      codecks: { account },
      codecksMappings: [mapping, secret],
    };
    await integration.save();
    const user = await buildUser({ teamId: team.id });
    mockDecks({
      [mapping.projectId]: ["deck-1"],
      [secret.projectId]: ["deck-secret"],
    });
    const visible = buildCard(mapping.projectId);
    const search = vi
      .spyOn(Codecks, "searchCards")
      .mockResolvedValue([
        visible,
        { ...buildCard(secret.projectId), accountSeq: 151 },
        { ...buildCard(randomUUID()), accountSeq: 152 },
        { ...buildCard(mapping.projectId), accountSeq: 153, project: null },
      ]);

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(search.mock.calls[0][1].deckIds).toEqual(["deck-1"]);
    expect(body.data).toEqual([presentCard(visible, account.subdomain)]);
  });

  it("should narrow results to the projects of the document's collection", async () => {
    const { team, admin, account, mapping, integration } =
      await buildConnectedTeam();
    const art = await buildCollection({ teamId: team.id, userId: admin.id });
    const artMapping: CodecksMapping = {
      projectId: randomUUID(),
      projectName: "Art",
      collectionId: art.id,
      defaultDeckId: null,
    };
    integration.settings = {
      codecks: { account },
      codecksMappings: [mapping, artMapping],
    };
    await integration.save();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: admin.id,
      collectionId: art.id,
    });
    mockDecks({
      [mapping.projectId]: ["deck-1"],
      [artMapping.projectId]: ["deck-art"],
    });
    const search = vi
      .spyOn(Codecks, "searchCards")
      .mockResolvedValue([buildCard(mapping.projectId)]);

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "", documentId: document.urlId },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(search.mock.calls[0][1].deckIds).toEqual(["deck-art"]);
    expect(body.data).toEqual([]);
  });

  it("should search every allowed project when the document's collection is not mapped", async () => {
    const { team, admin, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({ teamId: team.id, userId: admin.id });
    mockDecks({ [mapping.projectId]: ["deck-1"] });
    const search = vi.spyOn(Codecks, "searchCards").mockResolvedValue([]);

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "", documentId: document.id },
    });

    expect(res.status).toEqual(200);
    expect(search.mock.calls[0][1].deckIds).toEqual(["deck-1"]);
  });

  it("should not widen results to a collection the user cannot read", async () => {
    const { team, admin, account, mapping, integration } =
      await buildConnectedTeam();
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    integration.settings = {
      codecks: { account },
      codecksMappings: [
        mapping,
        {
          projectId: randomUUID(),
          projectName: "Secret",
          collectionId: privateCollection.id,
          defaultDeckId: null,
        },
      ],
    };
    await integration.save();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: admin.id,
      collectionId: privateCollection.id,
    });
    await UserMembership.create({
      createdById: admin.id,
      documentId: document.id,
      userId: user.id,
      permission: DocumentPermission.Read,
    });
    const list = mockDecks({ [mapping.projectId]: ["deck-1"] });
    const search = vi.spyOn(Codecks, "searchCards");

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "", documentId: document.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("should reject a document the user cannot read", async () => {
    const { team } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument();
    const search = vi.spyOn(Codecks, "searchCards");

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "", documentId: document.id },
    });

    expect(res.status).toEqual(403);
    expect(search).not.toHaveBeenCalled();
  });

  it("should keep a query a literal value of the Codecks filter", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    mockDecks({ [mapping.projectId]: ["deck-1"] });
    const query = vi
      .spyOn(Codecks, "query")
      .mockResolvedValue({ _root: { account: "account-1" } });
    const text = `"}),cards({"visibility":"deleted","deckId":"x"}),{"a":"\\"`;

    const res = await server.post("/api/codecks.search", user, {
      body: { query: text },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      {
        [cardsKey({
          deckId: { op: "in", value: ["deck-1"] },
          visibility: "default",
          title: { op: "contains", value: text },
          ...recent,
        })]: expect.any(Array),
      },
    ]);
  });

  it("should limit the length of a query", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    mockDecks({ [mapping.projectId]: ["deck-1"] });
    const search = vi.spyOn(Codecks, "searchCards").mockResolvedValue([]);

    const tooLong = await server.post("/api/codecks.search", user, {
      body: { query: "a".repeat(101) },
    });

    expect(tooLong.status).toEqual(400);
    expect(search).not.toHaveBeenCalled();

    const longest = await server.post("/api/codecks.search", user, {
      body: { query: ` ${"a".repeat(100)} ` },
    });

    expect(longest.status).toEqual(200);
    expect(search.mock.calls[0][1].query).toEqual("a".repeat(100));
  });

  it("should find a card by its short id first", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    mockDecks({ [mapping.projectId]: ["deck-1"] });
    const row = { visibility: "default", deck: "deck-1" };
    const query = vi.spyOn(Codecks, "query").mockResolvedValue({
      _root: { account: "account-1" },
      card: {
        "card-200": {
          ...row,
          cardId: "card-200",
          accountSeq: 200,
          title: "Explain 16a",
          lastUpdatedAt: "2026-02-01T00:00:00.000Z",
        },
        "card-150": {
          ...row,
          cardId: "card-150",
          accountSeq: 150,
          title: "Document how things work",
          lastUpdatedAt: "2025-01-01T00:00:00.000Z",
        },
      },
      deck: { "deck-1": { title: "Backlog", project: mapping.projectId } },
      project: { [mapping.projectId]: { name: "Game" } },
    });
    const scope = {
      deckId: { op: "in", value: ["deck-1"] },
      visibility: "default",
    };

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "16a" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ id: "$16a", url: cardUrl });
    expect(body.data[1]).toMatchObject({ title: "Explain 16a" });
    expect(query.mock.calls[0][1]).toEqual([
      {
        [cardsKey({ ...scope, accountSeq: { op: "in", value: [150] } })]:
          expect.any(Array),
      },
      {
        [cardsKey({
          ...scope,
          title: { op: "contains", value: "16a" },
          ...recent,
        })]: expect.any(Array),
      },
    ]);
  });

  it("should find nothing for the start of a short id", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    mockDecks({ [mapping.projectId]: ["deck-1"] });
    const query = vi.spyOn(Codecks, "query");

    const res = await server.post("/api/codecks.search", user, {
      body: { query: "16" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("should cache the decks of the organization", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const list = mockDecks({ [mapping.projectId]: ["deck-1"] });
    const search = vi.spyOn(Codecks, "searchCards").mockResolvedValue([]);

    for (const query of ["a", "b"]) {
      const res = await server.post("/api/codecks.search", user, {
        body: { query },
      });
      expect(res.status).toEqual(200);
    }

    expect(list).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("should return a fixed message when Codecks fails", async () => {
    const { team, mapping } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    mockDecks({ [mapping.projectId]: ["deck-1"] });
    vi.spyOn(Codecks, "searchCards")
      .mockRejectedValueOnce(new Error("upstream detail"))
      .mockRejectedValueOnce(
        new CodecksError(CodecksErrorCode.RateLimited, 429)
      );

    const failed = await server.post("/api/codecks.search", user, {
      body: { query: "" },
    });
    const failedBody = await failed.json();
    const limited = await server.post("/api/codecks.search", user, {
      body: { query: "" },
    });
    const limitedBody = await limited.json();

    expect(failed.status).toEqual(400);
    expect(failedBody.message).not.toContain("upstream detail");
    expect(limited.status).toEqual(400);
    expect(limitedBody.message).toEqual(
      new CodecksError(CodecksErrorCode.RateLimited).message
    );
  });
});
