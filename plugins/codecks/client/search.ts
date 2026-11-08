/** The results of a card search, with what was searched for. */
export interface CardSearchResults<T> {
  /** The query that was searched for. */
  query: string;
  /** The document that narrowed the search, if any. */
  documentId: string | undefined;
  /** The cards found. */
  cards: T[];
}

/**
 * Turns the text typed after the trigger into a search query, trimmed and
 * limited to the length the search accepts.
 *
 * @param search the text typed after the trigger.
 * @returns the query to search for.
 */
export function toSearchQuery(search: string): string {
  return search.trim().slice(0, MaxQueryLength);
}

/**
 * Whether search results answer the current query.
 *
 * @param results the latest results, if any.
 * @param query the current query.
 * @param documentId the document being edited, if any.
 * @returns true if the results were searched for the same query and document.
 */
export function isCurrentSearch<T>(
  results: CardSearchResults<T> | undefined,
  query: string,
  documentId: string | undefined
): results is CardSearchResults<T> {
  return (
    !!results && results.query === query && results.documentId === documentId
  );
}

/**
 * Whether the card menu should close because the text typed after the trigger
 * reads as ordinary text rather than a card search, such as "$5 per hour", or
 * because there is nothing to show.
 *
 * @param search the text typed after the trigger.
 * @param results the latest results, if any.
 * @param documentId the document being edited, if any.
 * @returns true if the menu should close.
 */
export function shouldCloseCardMenu<T>(
  search: string,
  results: CardSearchResults<T> | undefined,
  documentId: string | undefined
): boolean {
  const query = toSearchQuery(search);
  const hasSpace = /\s/.test(search);

  // Short ids start with a digit far more often than titles do, so a space
  // after one is taken as a price or a quantity.
  if (hasSpace && /^\d/.test(query)) {
    return true;
  }

  if (
    !results ||
    results.cards.length > 0 ||
    results.documentId !== documentId
  ) {
    return false;
  }

  // Searches match titles, so a longer query cannot find what a shorter one
  // did not, and a space then means the user carried on writing.
  if (hasSpace && query.startsWith(results.query)) {
    return true;
  }

  return results.query === "" && query === "";
}

/**
 * Whether Enter should start a new line, rather than mention the first card,
 * until the user moves the selection. That is the case for a bare trigger and
 * for a query of digits only, which is more likely an amount such as "$199"
 * than the short id of a card.
 *
 * @param query the current query.
 * @returns true if Enter should start a new line until the selection is moved.
 */
export function isEnterNewLineQuery(query: string): boolean {
  return /^\d*$/.test(query);
}

/** The longest query that the search accepts, in characters. */
const MaxQueryLength = 100;
