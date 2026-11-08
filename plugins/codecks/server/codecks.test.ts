import { randomUUID } from "node:crypto";
import { http, HttpResponse } from "msw";
import {
  CollectionPermission,
  IntegrationService,
  IntegrationType,
  UnfurlResourceType,
} from "@shared/types";
import {
  Integration,
  IntegrationAuthentication,
  UserMembership,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import Redis from "@server/storage/redis";
import {
  buildAdmin,
  buildCollection,
  buildGuestUser,
  buildIntegration,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { server } from "@server/test/msw";
import { CacheHelper } from "@server/utils/CacheHelper";
import type { CodecksAccount } from "../shared/types";
import { CardLoader } from "./CardLoader";
import {
  Codecks,
  CodecksError,
  CodecksErrorCode,
  type CodecksCard,
} from "./codecks";
import { allowedProjectIds } from "./gate";
import { CodecksLimiter } from "./limiter";
import { presentCard } from "./presenters";
import { uninstall } from "./uninstall";

const subdomain = "acme";
const token = "cdxat_test";
const cardUrl = "https://acme.codecks.io/card/16a-document-how-things-work";
const cardSeq = 150;
const apiUrl = "https://api.codecks.io/";

function buildCard(overrides: Partial<CodecksCard> = {}): CodecksCard {
  return {
    cardId: randomUUID(),
    accountSeq: cardSeq,
    title: "Document how things work",
    content: "Document how things work\n\nStart with the editor.",
    status: "started",
    derivedStatus: "started",
    priority: "a",
    effort: 2,
    isDoc: false,
    visibility: "default",
    childCount: 0,
    createdAt: "2026-01-02T03:04:05.000Z",
    lastUpdatedAt: "2026-02-03T04:05:06.000Z",
    assignee: {
      name: "jo",
      fullName: "Jo Doe",
      avatarUrl: "https://files.codecks.io/jo.png",
    },
    parent: { accountSeq: 1, title: "Documentation" },
    deck: { id: randomUUID(), title: "Backlog", coverColor: "#ff8800" },
    project: { id: randomUUID(), name: "Game" },
    milestone: { name: "Alpha", color: "blue" },
    ...overrides,
  };
}

async function buildConnectedTeam(
  options: { permission?: CollectionPermission | null } = {}
) {
  const team = await buildTeam();
  const admin = await buildAdmin({ teamId: team.id });
  const collection = await buildCollection({
    teamId: team.id,
    userId: admin.id,
    permission: options.permission,
  });
  const account: CodecksAccount = {
    id: randomUUID(),
    name: "Acme",
    subdomain,
  };
  const projectId = randomUUID();
  const authentication = await IntegrationAuthentication.create({
    service: IntegrationService.Codecks,
    userId: admin.id,
    teamId: team.id,
    token,
  });
  const integration = await Integration.create<
    Integration<IntegrationType.Embed>
  >({
    service: IntegrationService.Codecks,
    type: IntegrationType.Embed,
    userId: admin.id,
    teamId: team.id,
    authenticationId: authentication.id,
    settings: {
      codecks: { account },
      codecksMappings: [
        {
          projectId,
          projectName: "Game",
          collectionId: collection.id,
          defaultDeckId: null,
        },
      ],
    },
  });

  return { team, admin, collection, account, projectId, integration };
}

/** Responds to every Codecks API request and counts them. */
function mockApi(respond: (request: Request) => Response | Promise<Response>): {
  count: number;
  requests: Request[];
} {
  const calls = { count: 0, requests: [] as Request[] };
  server.use(
    http.post(apiUrl, ({ request }) => {
      calls.count++;
      calls.requests.push(request.clone());
      return respond(request);
    })
  );
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Codecks.unfurl", () => {
  it("should ignore other URLs without querying the database", async () => {
    const user = await buildUser();
    const findOne = vi.spyOn(Integration, "findOne");

    await expect(
      Codecks.unfurl("https://example.com/card/16a-title", user)
    ).resolves.toBeUndefined();
    await expect(
      Codecks.unfurl("https://api.codecks.io/card/16a-title", user)
    ).resolves.toBeUndefined();
    await expect(
      Codecks.unfurl("https://acme.codecks.io/decks/12-backlog", user)
    ).resolves.toBeUndefined();
    expect(findOne).not.toHaveBeenCalled();
  });

  it("should present a card of a mapped collection the user can read", async () => {
    const { team, account, projectId } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const card = buildCard({ project: { id: projectId, name: "Game" } });
    const getCards = vi
      .spyOn(Codecks, "getCardsBySeq")
      .mockResolvedValue([card]);

    const result = await Codecks.unfurl(cardUrl, user);

    expect(getCards).toHaveBeenCalledTimes(1);
    expect(getCards.mock.calls[0][0]).toEqual({
      token,
      subdomain,
      accountId: account.id,
    });
    expect(getCards.mock.calls[0][1]).toEqual([cardSeq]);
    expect(result).toEqual(presentCard(card, subdomain));
    expect(result).toMatchObject({
      type: UnfurlResourceType.Issue,
      id: "$16a",
      url: cardUrl,
      title: "Document how things work",
      description: "Start with the editor.",
      author: { name: "", avatarUrl: "" },
      labels: [],
      state: { name: "opened" },
      createdAt: "2026-01-02T03:04:05.000Z",
    });
  });

  it("should not present a card of a private collection to a non-member", async () => {
    const { team } = await buildConnectedTeam({ permission: null });
    const user = await buildUser({ teamId: team.id });
    const getCards = vi.spyOn(Codecks, "getCardsBySeq");

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).not.toHaveBeenCalled();
  });

  it("should present a card of a private collection to a member", async () => {
    const { team, collection, projectId } = await buildConnectedTeam({
      permission: null,
    });
    const user = await buildUser({ teamId: team.id });
    await UserMembership.create({
      createdById: user.id,
      collectionId: collection.id,
      userId: user.id,
      permission: CollectionPermission.Read,
    });
    vi.spyOn(Codecks, "getCardsBySeq").mockResolvedValue([
      buildCard({ project: { id: projectId, name: "Game" } }),
    ]);

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toMatchObject({ type: UnfurlResourceType.Issue });
  });

  it("should not present a card of an unmapped project", async () => {
    const { team } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    vi.spyOn(Codecks, "getCardsBySeq").mockResolvedValue([buildCard()]);

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
  });

  it("should not present a cached card to a user who cannot read its collection", async () => {
    const { team, admin, account, collection, projectId, integration } =
      await buildConnectedTeam();
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const privateProjectId = randomUUID();
    integration.settings = {
      codecks: { account },
      codecksMappings: [
        {
          projectId,
          projectName: "Game",
          collectionId: collection.id,
          defaultDeckId: null,
        },
        {
          projectId: privateProjectId,
          projectName: "Secret",
          collectionId: privateCollection.id,
          defaultDeckId: null,
        },
      ],
    };
    await integration.save();
    const member = await buildUser({ teamId: team.id });
    await UserMembership.create({
      createdById: admin.id,
      collectionId: privateCollection.id,
      userId: member.id,
      permission: CollectionPermission.Read,
    });
    const nonMember = await buildUser({ teamId: team.id });
    const getCards = vi
      .spyOn(Codecks, "getCardsBySeq")
      .mockResolvedValue([
        buildCard({ project: { id: privateProjectId, name: "Secret" } }),
      ]);

    await expect(Codecks.unfurl(cardUrl, member)).resolves.toMatchObject({
      type: UnfurlResourceType.Issue,
    });
    getCards.mockRejectedValue(
      new CodecksError(CodecksErrorCode.Unavailable, 503)
    );

    const result = await Codecks.unfurl(cardUrl, nonMember);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).toHaveBeenCalledTimes(1);
  });

  it("should check the current mappings when the card is cached", async () => {
    const { team, account, collection, projectId, integration } =
      await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const getCards = vi
      .spyOn(Codecks, "getCardsBySeq")
      .mockResolvedValue([
        buildCard({ project: { id: projectId, name: "Game" } }),
      ]);

    await expect(Codecks.unfurl(cardUrl, user)).resolves.toMatchObject({
      type: UnfurlResourceType.Issue,
    });
    integration.settings = {
      codecks: { account },
      codecksMappings: [
        {
          projectId: randomUUID(),
          projectName: "Other",
          collectionId: collection.id,
          defaultDeckId: null,
        },
      ],
    };
    await integration.save();

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).toHaveBeenCalledTimes(1);
  });

  it("should not present cards to guests, even of collections they belong to", async () => {
    const { team, collection } = await buildConnectedTeam();
    const guest = await buildGuestUser({ teamId: team.id });
    await UserMembership.create({
      createdById: guest.id,
      collectionId: collection.id,
      userId: guest.id,
      permission: CollectionPermission.Read,
    });
    const getCards = vi.spyOn(Codecks, "getCardsBySeq");

    const result = await Codecks.unfurl(cardUrl, guest);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).not.toHaveBeenCalled();
  });

  it("should not present cards to users of another team", async () => {
    await buildConnectedTeam();
    const user = await buildUser();
    const getCards = vi.spyOn(Codecks, "getCardsBySeq");

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).not.toHaveBeenCalled();
  });

  it("should fail closed when the mappings are malformed", async () => {
    const { team, integration, account, collection } =
      await buildConnectedTeam();
    await sequelize.query(
      "UPDATE integrations SET settings = :settings WHERE id = :id",
      {
        replacements: {
          id: integration.id,
          settings: JSON.stringify({
            codecks: { account },
            codecksMappings: [{ projectId: 5, collectionId: collection.id }],
          }),
        },
      }
    );
    const user = await buildUser({ teamId: team.id });
    const getCards = vi.spyOn(Codecks, "getCardsBySeq");

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).not.toHaveBeenCalled();
  });

  it("should not present a card of another organization", async () => {
    const { team } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const getCards = vi.spyOn(Codecks, "getCardsBySeq");

    const result = await Codecks.unfurl(
      "https://other.codecks.io/card/16a-document-how-things-work",
      user
    );

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
    expect(getCards).not.toHaveBeenCalled();
  });

  it("should return an error when the team is not connected", async () => {
    const user = await buildUser();

    const result = await Codecks.unfurl(cardUrl, user);

    expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
  });

  it("should return an error when Codecks fails, without caching it", async () => {
    const { team } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const getCards = vi
      .spyOn(Codecks, "getCardsBySeq")
      .mockRejectedValue(new CodecksError(CodecksErrorCode.Unavailable, 503));

    await expect(Codecks.unfurl(cardUrl, user)).resolves.toEqual({
      error: expect.any(String),
      cacheExpiry: 15,
    });
    await expect(Codecks.unfurl(cardUrl, user)).resolves.toEqual({
      error: expect.any(String),
      cacheExpiry: 15,
    });
    expect(getCards).toHaveBeenCalledTimes(2);
  });

  it("should return an error without a request while backing off", async () => {
    const { team, account } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const calls = mockApi(() => HttpResponse.json({}));
    await CodecksLimiter.backoff(account.id, "30");

    try {
      const result = await Codecks.unfurl(cardUrl, user);

      expect(result).toEqual({ error: expect.any(String), cacheExpiry: 15 });
      expect(calls.count).toEqual(0);
    } finally {
      await CodecksLimiter.clearBackoff(account.id);
    }
  });

  it("should cache cards that do not exist", async () => {
    const { team, account } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const getCards = vi.spyOn(Codecks, "getCardsBySeq").mockResolvedValue([]);

    await expect(Codecks.unfurl(cardUrl, user)).resolves.toEqual({
      error: expect.any(String),
      cacheExpiry: 15,
    });
    await expect(Codecks.unfurl(cardUrl, user)).resolves.toEqual({
      error: expect.any(String),
      cacheExpiry: 15,
    });

    expect(getCards).toHaveBeenCalledTimes(1);
    await expect(
      CacheHelper.getData(CardLoader.cacheKey(team.id, account.id, cardSeq))
    ).resolves.toBeNull();
  });
});

describe("allowedProjectIds", () => {
  it("should only allow projects of active collections the user can read", async () => {
    const { team, admin, account, collection, projectId, integration } =
      await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    const privateCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      permission: null,
    });
    const archivedCollection = await buildCollection({
      teamId: team.id,
      userId: admin.id,
      archivedAt: new Date(),
    });
    integration.settings = {
      codecks: { account },
      codecksMappings: [
        {
          projectId,
          projectName: "Game",
          collectionId: collection.id,
          defaultDeckId: null,
        },
        {
          projectId: "private",
          projectName: "Private",
          collectionId: privateCollection.id,
          defaultDeckId: null,
        },
        {
          projectId: "archived",
          projectName: "Archived",
          collectionId: archivedCollection.id,
          defaultDeckId: null,
        },
      ],
    };

    const allowed = await allowedProjectIds(user, integration);

    expect([...allowed]).toEqual([projectId]);
  });

  it("should allow nothing without mappings", async () => {
    const { team, account, integration } = await buildConnectedTeam();
    const user = await buildUser({ teamId: team.id });
    integration.settings = { codecks: { account } };

    const allowed = await allowedProjectIds(user, integration);

    expect(allowed.size).toEqual(0);
  });
});

describe("CardLoader", () => {
  it("should load concurrent requests together", async () => {
    const teamId = randomUUID();
    const accountId = randomUUID();
    const first = buildCard({ accountSeq: 1 });
    const second = buildCard({ accountSeq: 2 });
    const load = vi.fn((_accountSeqs: number[]) =>
      Promise.resolve([first, second])
    );

    const results = await Promise.all(
      [1, 2, 3].map((accountSeq) =>
        CardLoader.load({ teamId, accountId, load }, accountSeq)
      )
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect([...load.mock.calls[0][0]].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(results).toEqual([first, second, null]);
  });

  it("should keep collecting requests that arrive spread out", async () => {
    const teamId = randomUUID();
    const accountId = randomUUID();
    const load = vi.fn((accountSeqs: number[]) =>
      Promise.resolve(
        accountSeqs.map((accountSeq) => buildCard({ accountSeq }))
      )
    );

    const pending = [];
    for (const accountSeq of [1, 2, 3]) {
      pending.push(CardLoader.load({ teamId, accountId, load }, accountSeq));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await Promise.all(pending);

    expect(load).toHaveBeenCalledTimes(1);
    expect([...load.mock.calls[0][0]].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("should not cache cards that could not be loaded", async () => {
    const teamId = randomUUID();
    const accountId = randomUUID();
    const load = vi.fn(() =>
      Promise.reject(new CodecksError(CodecksErrorCode.Unavailable))
    );

    await expect(
      CardLoader.load({ teamId, accountId, load }, 1)
    ).resolves.toBeUndefined();
    await expect(
      CacheHelper.getData(CardLoader.cacheKey(teamId, accountId, 1))
    ).resolves.toBeUndefined();
  });
});

describe("Codecks client", () => {
  it("should send the token and subdomain when reading the account", async () => {
    const calls = mockApi(() =>
      HttpResponse.json({
        _root: { account: "account-1" },
        account: { "account-1": { id: "account-1", name: "Acme Studio" } },
      })
    );

    const account = await Codecks.getAccount(token, subdomain);

    expect(account).toEqual({
      id: "account-1",
      name: "Acme Studio",
      subdomain,
    });
    const [request] = calls.requests;
    expect(request.headers.get("authorization")).toEqual(`Bearer ${token}`);
    expect(request.headers.get("x-account")).toEqual(subdomain);
    expect(await request.json()).toEqual({
      query: { _root: [{ account: ["name"] }] },
    });
  });

  it("should reject a token of another organization", async () => {
    mockApi(() =>
      HttpResponse.json(
        { error: "token_account_mismatch", message: "upstream detail" },
        { status: 400 }
      )
    );

    const error = await Codecks.getAccount(token, subdomain).catch(
      (err: unknown) => err
    );

    expect(error).toBeInstanceOf(CodecksError);
    expect(error).toMatchObject({ code: CodecksErrorCode.AccountMismatch });
    expect(String(error)).not.toContain("upstream detail");
  });

  it("should reject an invalid token", async () => {
    mockApi(() =>
      HttpResponse.json(
        { error: "invalid_token", message: "upstream detail" },
        { status: 401 }
      )
    );

    await expect(Codecks.getAccount(token, subdomain)).rejects.toMatchObject({
      code: CodecksErrorCode.Unauthorized,
    });
  });

  it("should back off after being rate limited", async () => {
    const accountId = randomUUID();
    const connection = { token, subdomain, accountId };
    const calls = mockApi(
      () =>
        new HttpResponse(JSON.stringify({ error: "rate_limit" }), {
          status: 429,
          headers: { "Retry-After": "20" },
        })
    );

    try {
      await expect(
        Codecks.getCardsBySeq(connection, [cardSeq])
      ).rejects.toMatchObject({ code: CodecksErrorCode.RateLimited });
      const ttl = await Redis.defaultClient.ttl(
        CodecksLimiter.backoffKey(accountId)
      );
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(20);

      await expect(
        Codecks.getCardsBySeq(connection, [cardSeq])
      ).rejects.toMatchObject({ code: CodecksErrorCode.RateLimited });
      expect(calls.count).toEqual(1);
    } finally {
      await CodecksLimiter.clearBackoff(accountId);
    }
  });

  it("should resolve cards from a normalised response", async () => {
    const calls = mockApi(() =>
      HttpResponse.json({
        _root: { account: "account-1" },
        account: { "account-1": { id: "account-1" } },
        card: {
          "card-1": {
            cardId: "card-1",
            accountSeq: cardSeq,
            title: "Document how things work",
            content: "Document how things work\nDetails",
            status: "done",
            derivedStatus: "someFutureStatus",
            priority: "z",
            effort: null,
            isDoc: false,
            visibility: "default",
            createdAt: "2026-01-02T03:04:05Z",
            lastUpdatedAt: 1767323045000,
            "count:childCards": 3,
            assignee: "user-1",
            parentCard: "card-2",
            deck: "deck-1",
            milestone: null,
            unknownField: { nested: true },
          },
          "card-2": { cardId: "card-2", accountSeq: 1, title: "Parent" },
        },
        user: {
          "user-1": {
            id: "user-1",
            name: "jo",
            fullName: null,
            profileImage: "file-1",
          },
        },
        file: { "file-1": { id: "file-1", url: "" } },
        deck: {
          "deck-1": {
            id: "deck-1",
            title: "Backlog",
            coverColor: "#ff8800",
            project: "project-1",
          },
        },
        project: { "project-1": { id: "project-1", name: "Game" } },
      })
    );

    const cards = await Codecks.getCardsBySeq({ token, subdomain }, [
      cardSeq,
      cardSeq,
    ]);

    expect(cards).toEqual([
      {
        cardId: "card-1",
        accountSeq: cardSeq,
        title: "Document how things work",
        content: "Document how things work\nDetails",
        status: "done",
        derivedStatus: "someFutureStatus",
        priority: "z",
        effort: null,
        isDoc: false,
        visibility: "default",
        childCount: 3,
        createdAt: "2026-01-02T03:04:05.000Z",
        lastUpdatedAt: new Date(1767323045000).toISOString(),
        assignee: { name: "jo", fullName: null, avatarUrl: null },
        parent: { accountSeq: 1, title: "Parent" },
        deck: { id: "deck-1", title: "Backlog", coverColor: "#ff8800" },
        project: { id: "project-1", name: "Game" },
        milestone: null,
      },
    ]);
    const body = await calls.requests[0].json();
    expect(Object.keys(body.query._root[0].account[0])).toEqual([
      'cards({"accountSeq":{"op":"in","value":[150]}})',
    ]);
  });

  it("should group decks by project", async () => {
    mockApi(() =>
      HttpResponse.json({
        _root: { account: "account-1" },
        deck: {
          "deck-2": { id: "deck-2", title: "Zeta", project: "project-1" },
          "deck-1": {
            id: "deck-1",
            title: "Alpha",
            coverColor: "#00ff00",
            project: "project-1",
          },
          "deck-3": { id: "deck-3", title: "Other", project: "project-2" },
        },
        project: {
          "project-1": { id: "project-1", name: "Game" },
          "project-2": { id: "project-2", name: "Art" },
        },
      })
    );

    const projects = await Codecks.listProjectsWithDecks({ token, subdomain });

    expect(projects).toEqual([
      {
        id: "project-2",
        name: "Art",
        decks: [{ id: "deck-3", title: "Other", coverColor: null }],
      },
      {
        id: "project-1",
        name: "Game",
        decks: [
          { id: "deck-1", title: "Alpha", coverColor: "#00ff00" },
          { id: "deck-2", title: "Zeta", coverColor: null },
        ],
      },
    ]);
  });
});

describe("uninstall", () => {
  it("should lift the backoff of the organization", async () => {
    const { integration, account } = await buildConnectedTeam();
    await CodecksLimiter.backoff(account.id, "30");

    await uninstall(integration);

    await expect(CodecksLimiter.isBackingOff(account.id)).resolves.toBe(false);
  });

  it("should ignore integrations of other services", async () => {
    const integration = await buildIntegration();

    await expect(uninstall(integration)).resolves.toBeUndefined();
  });
});

describe("presentCard", () => {
  it("should present the card details", () => {
    const card = buildCard();

    const unfurl = presentCard(card, subdomain);

    expect(unfurl.codecks).toEqual({
      accountSeq: cardSeq,
      shortId: "16a",
      status: "started",
      derivedStatus: "started",
      priority: "a",
      effort: 2,
      isDoc: false,
      visibility: "default",
      childCount: 0,
      parent: {
        title: "Documentation",
        shortId: "111",
        url: "https://acme.codecks.io/card/111-documentation",
      },
      assignee: {
        name: "Jo Doe",
        avatarUrl: "https://files.codecks.io/jo.png",
      },
      deck: { title: "Backlog", coverColor: "#ff8800" },
      project: card.project,
      milestone: { name: "Alpha", color: "blue" },
      lastUpdatedAt: "2026-02-03T04:05:06.000Z",
    });
  });

  it("should fall back for missing names and unsafe values", () => {
    const unfurl = presentCard(
      buildCard({
        priority: "z",
        assignee: { name: "", fullName: null, avatarUrl: "http://x.test/a" },
        deck: { id: "deck", title: "Deck", coverColor: "red; color: blue" },
      }),
      subdomain
    );

    expect(unfurl.codecks?.priority).toBeNull();
    expect(unfurl.codecks?.assignee).toEqual({ name: "", avatarUrl: null });
    expect(unfurl.codecks?.deck?.coverColor).toBeNull();
  });

  it("should present a coarse state for renderers without Codecks support", () => {
    const open = presentCard(buildCard(), subdomain);
    const done = presentCard(buildCard({ status: "done" }), subdomain);

    expect(open.state.name).toEqual("opened");
    expect(done.state.name).toEqual("closed");
  });
});

describe("Codecks.searchCards", () => {
  const connection = { token, subdomain };
  const deckIds = ["deck-1", "deck-2"];
  const scope = { deckId: { op: "in", value: deckIds }, visibility: "default" };
  const recent = { $order: "-lastUpdatedAt", $limit: 10 };

  /** Reads the card filters back from the relation keys of a query. */
  function cardFilters(fields: Parameters<typeof Codecks.query>[1]) {
    return fields.flatMap((field) =>
      typeof field === "string"
        ? []
        : Object.keys(field).map((key): unknown => {
            const match = /^cards\((.*)\)$/.exec(key);
            return match ? JSON.parse(match[1]) : key;
          })
    );
  }

  function searchRow(accountSeq: number, overrides: object = {}) {
    return {
      cardId: `card-${accountSeq}`,
      accountSeq,
      title: `Card ${accountSeq}`,
      content: `Card ${accountSeq}`,
      status: "started",
      visibility: "default",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      deck: "deck-1",
      ...overrides,
    };
  }

  function searchResponse(cards: Record<string, object>) {
    return {
      _root: { account: "account-1" },
      card: cards,
      deck: {
        "deck-1": { id: "deck-1", title: "Backlog", project: "project-1" },
        "deck-3": { id: "deck-3", title: "Elsewhere", project: "project-2" },
      },
      project: {
        "project-1": { id: "project-1", name: "Game" },
        "project-2": { id: "project-2", name: "Art" },
      },
    };
  }

  it("should list the most recently updated cards for an empty query", async () => {
    const query = vi.spyOn(Codecks, "query").mockResolvedValue(
      searchResponse({
        "card-1": searchRow(1, { lastUpdatedAt: "2026-01-01T00:00:00.000Z" }),
        "card-2": searchRow(2, { lastUpdatedAt: "2026-03-01T00:00:00.000Z" }),
      })
    );

    const cards = await Codecks.searchCards(connection, {
      deckIds,
      query: "  ",
      limit: 10,
    });

    expect(cards.map((card) => card.accountSeq)).toEqual([2, 1]);
    expect(cards[0].project).toEqual({ id: "project-1", name: "Game" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toEqual(connection);
    expect(cardFilters(query.mock.calls[0][1])).toEqual([
      { ...scope, ...recent },
    ]);
  });

  it("should keep a query a literal value of the filter", async () => {
    const text = `x"}),cards({"deckId":"other"}) {"visibility":"deleted"} \\"`;
    const query = vi
      .spyOn(Codecks, "query")
      .mockResolvedValue(searchResponse({}));

    await Codecks.searchCards(connection, { deckIds, query: text, limit: 10 });

    const fields = query.mock.calls[0][1];
    expect(fields).toHaveLength(1);
    expect(cardFilters(fields)).toEqual([
      { ...scope, title: { op: "contains", value: text }, ...recent },
    ]);
  });

  it("should send a query as a literal value to Codecks", async () => {
    const text = `"}) {"$or":[{"deckId":"other"}]}`;
    const calls = mockApi(() => HttpResponse.json(searchResponse({})));

    await Codecks.searchCards(connection, { deckIds, query: text, limit: 10 });

    const body = await calls.requests[0].json();
    const keys = Object.keys(body.query._root[0].account[0]);
    expect(keys).toHaveLength(1);
    expect(JSON.parse(keys[0].slice("cards(".length, -1))).toEqual({
      ...scope,
      title: { op: "contains", value: text },
      ...recent,
    });
  });

  it("should find a card by its short id first", async () => {
    const query = vi.spyOn(Codecks, "query").mockResolvedValue(
      searchResponse({
        "card-150": searchRow(150, {
          lastUpdatedAt: "2025-01-01T00:00:00.000Z",
          parentCard: "card-1",
        }),
        "card-200": searchRow(200, { title: "Explain 16a" }),
        "card-1": { cardId: "card-1", accountSeq: 1, title: "Parent" },
        "card-300": searchRow(300, { visibility: "archived" }),
        "card-400": searchRow(400, { deck: "deck-3" }),
      })
    );

    const cards = await Codecks.searchCards(connection, {
      deckIds,
      query: "16A",
      limit: 10,
    });

    expect(cards.map((card) => card.accountSeq)).toEqual([150, 200]);
    expect(cards[0].parent).toEqual({ accountSeq: 1, title: "Parent" });
    expect(cardFilters(query.mock.calls[0][1])).toEqual([
      { ...scope, accountSeq: { op: "in", value: [150] } },
      { ...scope, title: { op: "contains", value: "16A" }, ...recent },
    ]);
  });

  it("should find nothing for the start of a short id or an amount", async () => {
    const query = vi.spyOn(Codecks, "query");

    for (const text of ["1", "16", "100", "5 per hour", "16a b"]) {
      await expect(
        Codecks.searchCards(connection, { deckIds, query: text, limit: 10 })
      ).resolves.toEqual([]);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("should not query without decks and cap the limit", async () => {
    const query = vi.spyOn(Codecks, "query").mockResolvedValue(
      searchResponse({
        "card-1": searchRow(1),
        "card-2": searchRow(2),
        "card-3": searchRow(3),
      })
    );

    await expect(
      Codecks.searchCards(connection, { deckIds: [], query: "", limit: 10 })
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();

    await expect(
      Codecks.searchCards(connection, { deckIds, query: "", limit: 2 })
    ).resolves.toHaveLength(2);
    await Codecks.searchCards(connection, { deckIds, query: "", limit: 1000 });
    expect(cardFilters(query.mock.calls[1][1])).toEqual([
      { ...scope, $order: "-lastUpdatedAt", $limit: 25 },
    ]);
  });
});
