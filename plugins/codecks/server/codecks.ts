import { z } from "zod";
import { IntegrationService, IntegrationType } from "@shared/types";
import { Second } from "@shared/utils/time";
import { Integration, IntegrationAuthentication } from "@server/models";
import type { UnfurlError, UnfurlSignature } from "@server/types";
import fetch, { Headers } from "@server/utils/fetch";
import { CodecksUtils } from "../shared/CodecksUtils";
import type { CodecksAccount, CodecksProject } from "../shared/types";
import { CardLoader } from "./CardLoader";
import { allowedProjectIds, getCodecksAccount } from "./gate";
import { CodecksLimiter } from "./limiter";
import { presentCard } from "./presenters";

/** The token and organization that a request to Codecks is made with. */
export interface CodecksConnection {
  /** The organization API token. */
  token: string;
  /** The organization's subdomain, sent so that tokens of other organizations are rejected. */
  subdomain?: string;
  /** The account ID, when known, used to pause requests after Codecks rate limits them. */
  accountId?: string;
}

/** A card with its related rows resolved, as returned by the API and cached. */
export interface CodecksCard {
  cardId: string;
  accountSeq: number;
  title: string;
  content: string;
  status: string;
  derivedStatus: string | null;
  priority: string | null;
  effort: number | null;
  isDoc: boolean;
  visibility: string;
  childCount: number;
  createdAt: string | null;
  lastUpdatedAt: string | null;
  assignee: {
    name: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  } | null;
  parent: { accountSeq: number; title: string } | null;
  deck: { id: string; title: string; coverColor: string | null } | null;
  project: { id: string; name: string } | null;
  milestone: { name: string; color: string | null } | null;
}

/** What Codecks.searchCards looks for. */
export interface CodecksCardSearch {
  /** The decks to search, cards of other decks are never returned. */
  deckIds: string[];
  /** A short id such as "16a", part of a title, or empty for recent cards. */
  query: string;
  /** The most cards to return. */
  limit: number;
}

/** The reasons a request to Codecks fails. */
export enum CodecksErrorCode {
  Unauthorized = "unauthorized",
  Forbidden = "forbidden",
  AccountMismatch = "account_mismatch",
  RateLimited = "rate_limited",
  Unavailable = "unavailable",
  InvalidResponse = "invalid_response",
}

/**
 * A failed request to Codecks. The message is fixed per code and never
 * contains anything from the upstream response, so it is safe to show.
 */
export class CodecksError extends Error {
  /** Why the request failed. */
  public readonly code: CodecksErrorCode;

  /** The upstream HTTP status, if a response was received. */
  public readonly status?: number;

  constructor(code: CodecksErrorCode, status?: number) {
    super(ErrorMessages[code]);
    this.name = "CodecksError";
    this.code = code;
    this.status = status;
  }
}

/** A static client for the Codecks API, see https://manual.codecks.io/api/. */
export class Codecks {
  /** The API host, requests never go anywhere else. */
  public static readonly apiUrl = "https://api.codecks.io/";

  /** The time allowed for a read, including the response body. */
  public static readonly readTimeout = 5 * Second.ms;

  /** The time allowed for a write, including the response body. */
  public static readonly writeTimeout = 10 * Second.ms;

  /** The largest response body that is read, in bytes. */
  public static readonly maxResponseSize = 2_000_000;

  /**
   * Unfurls a Codecks card URL for a user. Other URLs are left to other
   * providers. A card URL always resolves to a card or an error, so that it
   * never falls through to a generic provider.
   *
   * @param url the URL to unfurl.
   * @param actor the user viewing the URL.
   * @returns the card as an issue unfurl, an error, or undefined for other URLs.
   */
  public static unfurl: UnfurlSignature = async (url, actor) => {
    const ref = CodecksUtils.parseCardUrl(url);
    if (!ref) {
      return undefined;
    }
    if (!actor) {
      return Codecks.unfurlError("Not signed in");
    }

    const integration = await Integration.findOne({
      where: {
        service: IntegrationService.Codecks,
        type: IntegrationType.Embed,
        teamId: actor.teamId,
      },
      include: [
        {
          model: IntegrationAuthentication,
          as: "authentication",
          required: true,
        },
      ],
      order: [["createdAt", "ASC"]],
    });
    const account = integration ? getCodecksAccount(integration) : undefined;
    const token = integration?.authentication.token;
    if (!integration || !account || !token) {
      return Codecks.unfurlError("Codecks is not connected");
    }
    if (account.subdomain !== ref.subdomain) {
      return Codecks.unfurlError("Card of another organization");
    }

    // Checked before loading, so that users without access cause no requests.
    const allowed = await allowedProjectIds(actor, integration);
    if (allowed.size === 0) {
      return Codecks.unfurlError("Card not available");
    }

    const connection: CodecksConnection = {
      token,
      subdomain: account.subdomain,
      accountId: account.id,
    };
    const card = await CardLoader.load(
      {
        teamId: actor.teamId,
        accountId: account.id,
        load: (accountSeqs) =>
          Codecks.getCardsBySeq(
            connection,
            accountSeqs,
            CardLoader.requestTimeout
          ),
      },
      ref.accountSeq
    );

    if (card === undefined) {
      return Codecks.unfurlError("Card could not be loaded");
    }
    if (card === null || !card.project || !allowed.has(card.project.id)) {
      return Codecks.unfurlError("Card not available");
    }

    return presentCard(card, account.subdomain);
  };

  /**
   * Runs a read query.
   *
   * @param connection the token and organization to query.
   * @param fields the fields and relations to read from the account.
   * @param timeout the time allowed for the request in milliseconds.
   * @returns the normalised response, rows grouped by model and ID.
   * @throws CodecksError if the request fails.
   */
  public static async query(
    connection: CodecksConnection,
    fields: QueryField[],
    timeout = Codecks.readTimeout
  ): Promise<QueryResponse> {
    const body = await Codecks.request(
      connection,
      "",
      { query: { _root: [{ account: fields }] } },
      timeout
    );
    const parsed = ResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new CodecksError(CodecksErrorCode.InvalidResponse);
    }
    return parsed.data;
  }

  /**
   * Runs a write action, such as creating a card.
   *
   * @param connection the token and organization to write to.
   * @param namespace the action's namespace, e.g. "cards".
   * @param action the action, e.g. "create".
   * @param payload the action's parameters.
   * @returns the response body.
   * @throws CodecksError if the request fails.
   */
  public static async dispatch(
    connection: CodecksConnection,
    namespace: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    const segment = /^[a-zA-Z]+$/;
    if (!segment.test(namespace) || !segment.test(action)) {
      throw new Error("Invalid Codecks action");
    }
    return Codecks.request(
      connection,
      `dispatch/${namespace}/${action}`,
      payload,
      Codecks.writeTimeout
    );
  }

  /**
   * Validates a token and checks that it belongs to the organization with the
   * given subdomain.
   *
   * @param token the organization API token.
   * @param subdomain the organization's subdomain.
   * @returns the organization.
   * @throws CodecksError if the token is invalid or belongs to another organization.
   */
  public static async getAccount(
    token: string,
    subdomain: string
  ): Promise<CodecksAccount> {
    const response = await Codecks.query({ token, subdomain }, AccountFields);
    const root = RootSchema.safeParse(response);
    if (!root.success) {
      throw new CodecksError(CodecksErrorCode.InvalidResponse);
    }

    const id = root.data._root.account;
    const row = Codecks.rows(response, Models.Account, AccountRowSchema).get(
      id
    );
    return { id, name: row?.name || subdomain, subdomain };
  }

  /**
   * Lists the projects the token can read, each with its decks.
   *
   * @param connection the token and organization to query.
   * @returns the projects sorted by name, with decks sorted by title.
   * @throws CodecksError if the request fails.
   */
  public static async listProjectsWithDecks(
    connection: CodecksConnection
  ): Promise<CodecksProject[]> {
    const response = await Codecks.query(connection, [{ decks: DeckFields }]);
    const decks = Codecks.rows(response, Models.Deck, DeckRowSchema);
    const projectRows = Codecks.rows(
      response,
      Models.Project,
      ProjectRowSchema
    );

    const projects = new Map<string, CodecksProject>();
    for (const [deckId, deck] of decks) {
      if (!deck.project) {
        continue;
      }

      let project = projects.get(deck.project);
      if (!project) {
        project = {
          id: deck.project,
          name: projectRows.get(deck.project)?.name ?? "",
          decks: [],
        };
        projects.set(project.id, project);
      }
      project.decks.push({
        id: deckId,
        title: deck.title ?? "",
        coverColor: deck.coverColor ?? null,
      });
    }

    const byName = (a: string, b: string) => a.localeCompare(b);
    return [...projects.values()]
      .map((project) => ({
        ...project,
        decks: project.decks.sort((a, b) => byName(a.title, b.title)),
      }))
      .sort((a, b) => byName(a.name, b.name));
  }

  /**
   * Loads cards by their number within the organization.
   *
   * @param connection the token and organization to query.
   * @param accountSeqs the card numbers.
   * @param timeout the time allowed for the request in milliseconds.
   * @returns the cards that were found, in no particular order.
   * @throws CodecksError if the request fails.
   */
  public static async getCardsBySeq(
    connection: CodecksConnection,
    accountSeqs: number[],
    timeout = Codecks.readTimeout
  ): Promise<CodecksCard[]> {
    const requested = new Set(
      accountSeqs.filter((seq) => Number.isInteger(seq) && seq > 0)
    );
    if (requested.size === 0) {
      return [];
    }

    const filter: CardsFilter = {
      accountSeq: { op: "in", value: [...requested] },
    };
    const response = await Codecks.query(
      connection,
      [{ [`cards(${JSON.stringify(filter)})`]: CardFields }],
      timeout
    );
    return Codecks.readCards(response, requested);
  }

  /**
   * Searches the cards of some decks that are neither archived nor deleted.
   * An empty query finds the most recently updated cards. A complete short id
   * finds that card first, followed by cards whose title contains it. Any
   * other query that starts with a digit finds nothing, since it is the start
   * of a short id or an amount, and the remaining queries match titles.
   *
   * @param connection the token and organization to query.
   * @param search the decks to search, the query and the most cards to return.
   * @returns the cards, an exact short id match first and then the most recently updated.
   * @throws CodecksError if the request fails.
   */
  public static async searchCards(
    connection: CodecksConnection,
    search: CodecksCardSearch
  ): Promise<CodecksCard[]> {
    const deckIds = [...new Set(search.deckIds)];
    const query = search.query.trim();
    const limit = Math.min(
      Math.max(Math.floor(search.limit), 1),
      MaxSearchLimit
    );
    const exactSeq = query ? CodecksUtils.decodeShortId(query) : undefined;
    if (
      deckIds.length === 0 ||
      (exactSeq === undefined && DigitLedPattern.test(query))
    ) {
      return [];
    }

    const scope: CardSearchFilter = {
      deckId: { op: "in", value: deckIds },
      visibility: SearchVisibility,
    };
    const cards = (filter: CardSearchFilter): QueryRelation => ({
      [`cards(${JSON.stringify(filter)})`]: CardFields,
    });

    const fields: QueryField[] = [];
    if (exactSeq !== undefined) {
      fields.push(
        cards({ ...scope, accountSeq: { op: "in", value: [exactSeq] } })
      );
    }
    fields.push(
      cards({
        ...scope,
        ...(query ? { title: { op: "contains", value: query } } : {}),
        $order: SearchOrder,
        $limit: limit,
      })
    );

    const response = await Codecks.query(connection, fields);

    // Parent cards share the card rows but only hold the fields asked for
    // parents, so results are the rows of a searched deck and visibility.
    const searchedDecks = new Set(deckIds);
    const rows = Codecks.rows(response, Models.Card, CardRowSchema);
    const found = new Set<number>();
    for (const row of rows.values()) {
      if (
        row.visibility === SearchVisibility &&
        row.deck &&
        searchedDecks.has(row.deck)
      ) {
        found.add(row.accountSeq);
      }
    }

    const isExact = (card: CodecksCard) => Number(card.accountSeq === exactSeq);
    const updatedAt = (card: CodecksCard) =>
      card.lastUpdatedAt ? Date.parse(card.lastUpdatedAt) : 0;
    return Codecks.readCards(response, found)
      .sort((a, b) => isExact(b) - isExact(a) || updatedAt(b) - updatedAt(a))
      .slice(0, limit);
  }

  private static async request(
    connection: CodecksConnection,
    path: string,
    payload: object,
    timeout: number
  ): Promise<unknown> {
    const { accountId } = connection;
    if (accountId && (await CodecksLimiter.isBackingOff(accountId))) {
      throw new CodecksError(CodecksErrorCode.RateLimited);
    }
    if (!(await CodecksLimiter.consume())) {
      throw new CodecksError(CodecksErrorCode.RateLimited);
    }

    // A Headers instance keeps the token out of request logging, which only
    // sees its own enumerable properties.
    let headers: Headers;
    try {
      headers = new Headers({
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.token}`,
      });
      if (connection.subdomain) {
        headers.set("X-Account", connection.subdomain);
      }
    } catch {
      throw new CodecksError(CodecksErrorCode.Unauthorized);
    }

    const response = await fetch(`${Codecks.apiUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "error",
      size: Codecks.maxResponseSize,
      signal: AbortSignal.timeout(timeout),
    }).catch(() => {
      throw new CodecksError(CodecksErrorCode.Unavailable);
    });

    if (!response.ok) {
      let errorCode: string | undefined;
      try {
        const body = ErrorBodySchema.safeParse(await response.json());
        errorCode = body.success ? body.data.error : undefined;
      } catch {
        // The body is only read for its error code.
      }

      if (errorCode === "token_account_mismatch") {
        throw new CodecksError(
          CodecksErrorCode.AccountMismatch,
          response.status
        );
      }

      switch (response.status) {
        case 401:
          throw new CodecksError(CodecksErrorCode.Unauthorized, 401);
        case 403:
          throw new CodecksError(CodecksErrorCode.Forbidden, 403);
        case 429:
          if (accountId) {
            await CodecksLimiter.backoff(
              accountId,
              response.headers.get("retry-after")
            );
          }
          throw new CodecksError(CodecksErrorCode.RateLimited, 429);
        default:
          throw new CodecksError(
            response.status >= 500
              ? CodecksErrorCode.Unavailable
              : CodecksErrorCode.InvalidResponse,
            response.status
          );
      }
    }

    try {
      return await response.json();
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      throw new CodecksError(
        timedOut
          ? CodecksErrorCode.Unavailable
          : CodecksErrorCode.InvalidResponse,
        response.status
      );
    }
  }

  /**
   * Reads the rows of one model from a response, skipping rows that do not
   * match the schema.
   *
   * @param response the normalised response.
   * @param model the model name.
   * @param schema the schema of a row.
   * @returns the rows keyed by ID.
   */
  private static rows<T>(
    response: QueryResponse,
    model: string,
    schema: z.ZodType<T>
  ): Map<string, T> {
    const rows = new Map<string, T>();
    const table = TableSchema.safeParse(response[model]);
    if (!table.success) {
      return rows;
    }

    for (const [id, value] of Object.entries(table.data)) {
      const row = schema.safeParse(value);
      if (row.success) {
        rows.set(id, row.data);
      }
    }
    return rows;
  }

  private static readCards(
    response: QueryResponse,
    requested: Set<number>
  ): CodecksCard[] {
    const cards = Codecks.rows(response, Models.Card, CardRowSchema);
    const users = Codecks.rows(response, Models.User, UserRowSchema);
    const files = Codecks.rows(response, Models.File, FileRowSchema);
    const decks = Codecks.rows(response, Models.Deck, DeckRowSchema);
    const projects = Codecks.rows(response, Models.Project, ProjectRowSchema);
    const milestones = Codecks.rows(
      response,
      Models.Milestone,
      MilestoneRowSchema
    );
    const get = <T>(rows: Map<string, T>, id: string | null | undefined) =>
      id ? rows.get(id) : undefined;

    const result: CodecksCard[] = [];

    // Related cards such as parents share the card rows, so only the
    // requested numbers are returned.
    for (const [cardId, row] of cards) {
      if (!requested.has(row.accountSeq)) {
        continue;
      }

      const assignee = get(users, row.assignee);
      const parent = get(cards, row.parentCard);
      const deck = get(decks, row.deck);
      const projectId = deck?.project;
      const milestone = get(milestones, row.milestone);

      result.push({
        cardId,
        accountSeq: row.accountSeq,
        title: row.title ?? "",
        content: row.content ?? "",
        status: row.status ?? "not_started",
        derivedStatus: row.derivedStatus ?? null,
        priority: row.priority ?? null,
        effort: row.effort ?? null,
        isDoc: row.isDoc ?? false,
        visibility: row.visibility ?? "default",
        childCount: row["count:childCards"] ?? 0,
        createdAt: Codecks.toIsoString(row.createdAt),
        lastUpdatedAt: Codecks.toIsoString(row.lastUpdatedAt),
        assignee: assignee
          ? {
              name: assignee.name ?? null,
              fullName: assignee.fullName ?? null,
              avatarUrl: get(files, assignee.profileImage)?.url || null,
            }
          : null,
        parent: parent
          ? { accountSeq: parent.accountSeq, title: parent.title ?? "" }
          : null,
        deck:
          deck && row.deck
            ? {
                id: row.deck,
                title: deck.title ?? "",
                coverColor: deck.coverColor ?? null,
              }
            : null,
        project: projectId
          ? { id: projectId, name: get(projects, projectId)?.name ?? "" }
          : null,
        milestone: milestone
          ? { name: milestone.name ?? "", color: milestone.color ?? null }
          : null,
      });
    }

    return result;
  }

  private static toIsoString(
    value: string | number | null | undefined
  ): string | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private static unfurlError(error: string): UnfurlError {
    return { error, cacheExpiry: UnfurlErrorExpiry };
  }
}

const ErrorMessages: Record<CodecksErrorCode, string> = {
  [CodecksErrorCode.Unauthorized]:
    "Codecks did not accept the token. Check that it was copied in full and has not expired.",
  [CodecksErrorCode.Forbidden]:
    "The Codecks token does not have permission to read this organization.",
  [CodecksErrorCode.AccountMismatch]:
    "The token does not belong to the Codecks organization at this address.",
  [CodecksErrorCode.RateLimited]:
    "Codecks is receiving too many requests. Try again in a minute.",
  [CodecksErrorCode.Unavailable]:
    "Codecks could not be reached. Try again later.",
  [CodecksErrorCode.InvalidResponse]:
    "Codecks returned a response that could not be read. Try again later.",
};

// Queries are plain objects: the root, then relations as keys holding the
// fields to read. A relation key with a filter is the relation name followed
// by the JSON encoded filter in parentheses.
type QueryField = string | QueryRelation;

interface QueryRelation {
  [relation: string]: QueryField[];
}

interface CardsFilter {
  accountSeq: { op: "in"; value: number[] };
}

// Search filters only ever hold typed values and are serialised with
// JSON.stringify, so a search query stays a string value and can't change
// which decks or cards the filter selects.
interface CardSearchFilter {
  deckId: { op: "in"; value: string[] };
  visibility: typeof SearchVisibility;
  accountSeq?: { op: "in"; value: number[] };
  title?: { op: "contains"; value: string };
  $order?: string;
  $limit?: number;
}

// The field and model names below follow the Codecks API reference and were
// checked against the live API in November 2026. Adjust them here if Codecks
// starts rejecting a query.

/** The model names that response rows are grouped by. */
const Models = {
  Account: "account",
  Card: "card",
  Deck: "deck",
  File: "file",
  Milestone: "milestone",
  Project: "project",
  User: "user",
} as const;

const AccountFields: QueryField[] = ["name"];

const DeckFields: QueryField[] = ["title", "coverColor", { project: ["name"] }];

const CardFields: QueryField[] = [
  "cardId",
  "accountSeq",
  "title",
  "content",
  "status",
  "derivedStatus",
  "priority",
  "effort",
  "isDoc",
  "visibility",
  "createdAt",
  "lastUpdatedAt",
  "count:childCards",
  { assignee: ["name", "fullName", { profileImage: ["url"] }] },
  { parentCard: ["accountSeq", "title"] },
  { deck: DeckFields },
  { milestone: ["name", "color"] },
];

// Search is scoped by deck, since a card belongs to the project of its deck
// and cards are only known to filter by their own fields. Checked against the
// live API: "in" applies to deckId, a "-" prefix orders descending, and
// "contains" ignores case.

/** Searches skip archived and deleted cards. */
const SearchVisibility = "default";

/** Searches find the most recently updated cards first. */
const SearchOrder = "-lastUpdatedAt";

/** The most cards one search returns. */
const MaxSearchLimit = 25;

/** A search that starts with a digit and is not a short id finds nothing. */
const DigitLedPattern = /^\d/;

// Response rows are parsed leniently: unknown keys are ignored, enums are
// read as strings and a field of an unexpected type is treated as missing.
const OptionalString = z.string().nullish().catch(null);
const OptionalNumber = z.number().nullish().catch(null);
const OptionalBoolean = z.boolean().nullish().catch(null);
const OptionalTimestamp = z
  .union([z.string(), z.number()])
  .nullish()
  .catch(null);

const ResponseSchema = z.record(z.string(), z.unknown());

const TableSchema = z.record(z.string(), z.unknown());

const RootSchema = z.object({
  _root: z.object({ account: z.string().min(1) }),
});

const ErrorBodySchema = z.object({ error: z.string() });

const AccountRowSchema = z.object({ name: OptionalString });

const CardRowSchema = z.object({
  accountSeq: z.number().int().min(1),
  title: OptionalString,
  content: OptionalString,
  status: OptionalString,
  derivedStatus: OptionalString,
  priority: OptionalString,
  effort: OptionalNumber,
  isDoc: OptionalBoolean,
  visibility: OptionalString,
  createdAt: OptionalTimestamp,
  lastUpdatedAt: OptionalTimestamp,
  "count:childCards": OptionalNumber,
  assignee: OptionalString,
  parentCard: OptionalString,
  deck: OptionalString,
  milestone: OptionalString,
});

const UserRowSchema = z.object({
  name: OptionalString,
  fullName: OptionalString,
  profileImage: OptionalString,
});

const FileRowSchema = z.object({ url: OptionalString });

const DeckRowSchema = z.object({
  title: OptionalString,
  coverColor: OptionalString,
  project: OptionalString,
});

const ProjectRowSchema = z.object({ name: OptionalString });

const MilestoneRowSchema = z.object({
  name: OptionalString,
  color: OptionalString,
});

type QueryResponse = z.infer<typeof ResponseSchema>;

/** Unfurl errors are cached briefly, so access changes and outages recover quickly. */
const UnfurlErrorExpiry = 15;
