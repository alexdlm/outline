import { Second } from "@shared/utils/time";
import { CodecksUtils } from "../shared/CodecksUtils";

/** A card as searches compare it. */
export interface SearchableCard {
  /** The short id with its "$", such as "$16a". */
  id: string;
  /** The title. */
  title: string;
  /** The card's details, holding when it was last updated. */
  codecks?: { lastUpdatedAt: string | null } | null;
}

/** The results of a card search, with what was searched for. */
export interface CardSearchResults<T> {
  /** The query that was searched for. */
  query: string;
  /** The document that narrowed the search, if any. */
  documentId: string | undefined;
  /** The cards found, none if the search failed. */
  cards: T[];
  /** Whether the search failed. */
  failed?: boolean;
  /** When the results were received, in milliseconds since the epoch. */
  receivedAt: number;
}

/** What is known about the cards that answer a query. */
export interface CardSearchAnswer<T> {
  /** The cards known to match, an exact short id first and then the most recently updated. */
  cards: T[];
  /** Whether the cards are all that a search would find, so none is needed. */
  complete: boolean;
  /** Whether the latest search for the query failed. */
  failed: boolean;
}

/** The most cards a search returns, as limited by the server. */
export const SearchLimit = 10;

/** How long results answer queries before searching again, in milliseconds. */
export const ResultsFreshFor = 30 * Second.ms;

/** How long a failed search is shown before searching again, in milliseconds. */
export const RetryFailedAfter = 5 * Second.ms;

/**
 * Turns the text typed after the trigger into a search query. Searches ignore
 * case, so the query is lower case, trimmed and limited to the length the
 * search accepts.
 *
 * @param search the text typed after the trigger.
 * @returns the query to search for.
 */
export function toSearchQuery(search: string): string {
  return search.trim().toLowerCase().slice(0, MaxQueryLength);
}

/**
 * Whether a query cannot find any card: it starts with a digit but is not a
 * complete short id, so it is the start of one or an amount such as "5".
 *
 * @param query the query.
 * @returns true if a search for the query finds nothing.
 */
export function findsNothing(query: string): boolean {
  return /^\d/.test(query) && CodecksUtils.decodeShortId(query) === undefined;
}

/**
 * Whether a card answers a query as a search would find it: by its short id,
 * or by a title containing the query.
 *
 * @param card the card.
 * @param query the query, from toSearchQuery.
 * @returns true if a search for the query would find the card.
 */
export function matchesQuery(card: SearchableCard, query: string): boolean {
  if (!query) {
    return true;
  }
  if (findsNothing(query)) {
    return false;
  }
  return isShortIdOf(card, query) || card.title.toLowerCase().includes(query);
}

/**
 * Answers a query from earlier results, so that the menu narrows as the user
 * types instead of showing results for an earlier query until a search
 * returns. Searches match titles, so results that held every card for a
 * shorter query hold every card for a longer one that starts with it.
 *
 * @param results earlier results, for any query and document.
 * @param query the query, from toSearchQuery.
 * @param documentId the document being edited, if any.
 * @param now the current time in milliseconds since the epoch.
 * @returns the cards known to match and whether a search is still needed.
 */
export function answerQuery<T extends SearchableCard>(
  results: CardSearchResults<T>[],
  query: string,
  documentId: string | undefined,
  now: number
): CardSearchAnswer<T> {
  const relevant = results
    .filter((entry) => entry.documentId === documentId)
    .sort((a, b) => b.receivedAt - a.receivedAt);

  const seen = new Set<string>();
  const cards: T[] = [];
  for (const entry of relevant) {
    for (const card of entry.cards) {
      if (!seen.has(card.id) && matchesQuery(card, query)) {
        seen.add(card.id);
        cards.push(card);
      }
    }
  }

  const exact = (card: T) => Number(isShortIdOf(card, query));
  cards.sort((a, b) => exact(b) - exact(a) || updatedAt(b) - updatedAt(a));

  const hasExact = cards.some((card) => isShortIdOf(card, query));
  const isShortId = CodecksUtils.decodeShortId(query) !== undefined;
  const complete =
    findsNothing(query) ||
    relevant.some(
      (entry) =>
        !entry.failed &&
        now - entry.receivedAt < ResultsFreshFor &&
        (entry.query === query ||
          (query.startsWith(entry.query) &&
            entry.cards.length < SearchLimit &&
            (!isShortId || hasExact)))
    );
  const failed =
    !complete &&
    relevant.some(
      (entry) =>
        entry.failed &&
        entry.query === query &&
        now - entry.receivedAt < RetryFailedAfter
    );

  return { cards: cards.slice(0, SearchLimit), complete, failed };
}

/**
 * Whether the card menu should close because the text typed after the trigger
 * reads as ordinary text rather than a card search, such as "$5 per hour", or
 * because there is nothing to show.
 *
 * @param search the text typed after the trigger.
 * @param answer what is known about the cards that answer the query.
 * @returns true if the menu should close.
 */
export function shouldCloseCardMenu<T>(
  search: string,
  answer: CardSearchAnswer<T>
): boolean {
  const query = toSearchQuery(search);
  const hasSpace = /\s/.test(search);

  // Short ids start with a digit far more often than titles do, so a space
  // after one is taken as a price or a quantity.
  if (hasSpace && /^\d/.test(query)) {
    return true;
  }

  if (answer.failed) {
    return hasSpace;
  }

  if (!answer.complete || answer.cards.length > 0) {
    return false;
  }

  // A space after a query that found nothing means the user carried on
  // writing, and a bare trigger without recent cards has nothing to offer.
  return hasSpace || query === "";
}

function isShortIdOf(card: SearchableCard, query: string): boolean {
  return card.id.toLowerCase() === `$${query}`;
}

function updatedAt(card: SearchableCard): number {
  const value = card.codecks?.lastUpdatedAt;
  return value ? Date.parse(value) : 0;
}

/** The longest query that the search accepts, in characters. */
const MaxQueryLength = 100;
