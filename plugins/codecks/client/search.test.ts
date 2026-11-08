import type {
  CardSearchAnswer,
  CardSearchResults,
  SearchableCard,
} from "./search";
import {
  ResultsFreshFor,
  RetryFailedAfter,
  SearchLimit,
  answerQuery,
  findsNothing,
  matchesQuery,
  shouldCloseCardMenu,
  toSearchQuery,
} from "./search";

const now = Date.parse("2026-11-08T08:00:00.000Z");

const card = (
  id: string,
  title: string,
  lastUpdatedAt = "2026-11-01T00:00:00.000Z"
): SearchableCard => ({ id, title, codecks: { lastUpdatedAt } });

const results = (
  query: string,
  cards: SearchableCard[],
  options: Partial<CardSearchResults<SearchableCard>> = {}
): CardSearchResults<SearchableCard> => ({
  query,
  documentId: undefined,
  cards,
  receivedAt: now - 1000,
  ...options,
});

const answer = (
  cards: SearchableCard[],
  options: Partial<CardSearchAnswer<SearchableCard>> = {}
): CardSearchAnswer<SearchableCard> => ({
  cards,
  complete: true,
  failed: false,
  ...options,
});

const ids = (found: SearchableCard[]) => found.map((c) => c.id);

const jump = card("$16a", "Fix the jump bug", "2026-11-05T00:00:00.000Z");
const docs = card(
  "$16c",
  "Document how things work",
  "2026-11-07T00:00:00.000Z"
);
const art = card("$12z", "Peon Task AI", "2026-11-03T00:00:00.000Z");

describe("toSearchQuery", () => {
  it("trims the typed text and ignores case", () => {
    expect(toSearchQuery(" Jump Bug ")).toEqual("jump bug");
  });

  it("limits the query to the length the search accepts", () => {
    expect(toSearchQuery("a".repeat(150))).toHaveLength(100);
  });
});

describe("findsNothing", () => {
  it.each(["5", "19", "100", "1a"])(
    "is true for the start of a short id or an amount: %s",
    (query) => {
      expect(findsNothing(query)).toBe(true);
    }
  );

  it.each(["", "16a", "199", "jump", "a16"])(
    "is false for anything a search can find: %s",
    (query) => {
      expect(findsNothing(query)).toBe(false);
    }
  );
});

describe("matchesQuery", () => {
  it("matches every card for a bare trigger", () => {
    expect(matchesQuery(jump, "")).toBe(true);
  });

  it("matches titles regardless of case", () => {
    expect(matchesQuery(jump, "jump")).toBe(true);
    expect(matchesQuery(jump, "bug")).toBe(true);
    expect(matchesQuery(jump, "art")).toBe(false);
  });

  it("matches a complete short id", () => {
    expect(matchesQuery(jump, "16a")).toBe(true);
    expect(matchesQuery(docs, "16a")).toBe(false);
  });

  it("matches nothing for the start of a short id", () => {
    expect(matchesQuery(card("$16a", "16 bits"), "16")).toBe(false);
  });
});

describe("answerQuery", () => {
  it("narrows earlier results as the user types", () => {
    const found = answerQuery(
      [results("", [docs, jump, art])],
      "jump",
      undefined,
      now
    );

    expect(ids(found.cards)).toEqual(["$16a"]);
  });

  it("is complete when narrowing results that held every card", () => {
    const found = answerQuery(
      [results("", [docs, jump, art])],
      "jump",
      undefined,
      now
    );

    expect(found.complete).toBe(true);
  });

  it("needs a search when the results narrowed may have left cards out", () => {
    const full = Array.from({ length: SearchLimit }, (_, index) =>
      card(`$1${index + 1}a`, `Card ${index}`)
    );
    const found = answerQuery([results("", full)], "card", undefined, now);

    expect(ids(found.cards)).toHaveLength(SearchLimit);
    expect(found.complete).toBe(false);
  });

  it("does not narrow results for a query the new one does not extend", () => {
    const found = answerQuery([results("jump", [jump])], "art", undefined, now);

    expect(found.cards).toEqual([]);
    expect(found.complete).toBe(false);
  });

  it("needs a search for a short id missing from complete results", () => {
    const found = answerQuery(
      [results("", [docs, art])],
      "16a",
      undefined,
      now
    );

    expect(found.cards).toEqual([]);
    expect(found.complete).toBe(false);
  });

  it("answers a short id from any earlier results that hold it", () => {
    const found = answerQuery(
      [results("", [docs, jump])],
      "16a",
      undefined,
      now
    );

    expect(ids(found.cards)).toEqual(["$16a"]);
    expect(found.complete).toBe(true);
  });

  it("lists an exact short id first, then the most recently updated", () => {
    const named = card("$11f", "Notes on 16a", "2026-11-08T00:00:00.000Z");
    const found = answerQuery(
      [results("16a", [named, jump])],
      "16a",
      undefined,
      now
    );

    expect(ids(found.cards)).toEqual(["$16a", "$11f"]);
  });

  it("combines the results of several searches without repeating cards", () => {
    const found = answerQuery(
      [results("", [docs, art]), results("t", [art, jump, docs])],
      "t",
      undefined,
      now
    );

    expect(ids(found.cards)).toEqual(["$16c", "$16a", "$12z"]);
  });

  it("searches again once the results are stale", () => {
    const found = answerQuery(
      [results("", [jump], { receivedAt: now - ResultsFreshFor - 1 })],
      "",
      undefined,
      now
    );

    expect(ids(found.cards)).toEqual(["$16a"]);
    expect(found.complete).toBe(false);
  });

  it("ignores results for another document", () => {
    const found = answerQuery(
      [results("", [jump], { documentId: "doc" })],
      "",
      "other",
      now
    );

    expect(found.cards).toEqual([]);
    expect(found.complete).toBe(false);
  });

  it("reports a recent failed search, then searches again", () => {
    const failed = results("jump", [], { failed: true });

    expect(answerQuery([failed], "jump", undefined, now).failed).toBe(true);
    expect(
      answerQuery(
        [{ ...failed, receivedAt: now - RetryFailedAfter - 1 }],
        "jump",
        undefined,
        now
      )
    ).toMatchObject({ failed: false, complete: false });
  });

  it("knows without searching that the start of a short id finds nothing", () => {
    expect(answerQuery([], "16", undefined, now)).toEqual({
      cards: [],
      complete: true,
      failed: false,
    });
  });
});

describe("shouldCloseCardMenu", () => {
  it.each(["5 ", "5 per hour", "199 dollars", "16a fix"])(
    "closes when a query that starts with a digit has a space: %s",
    (search) => {
      expect(shouldCloseCardMenu(search, answer([jump]))).toBe(true);
    }
  );

  it.each(["5", "199", "16a"])(
    "stays open for a query that starts with a digit: %s",
    (search) => {
      expect(shouldCloseCardMenu(search, answer([jump]))).toBe(false);
    }
  );

  it("closes on a space after a query that found nothing", () => {
    expect(shouldCloseCardMenu("foo ", answer([]))).toBe(true);
    expect(shouldCloseCardMenu("foo bar", answer([]))).toBe(true);
  });

  it("stays open on a space after a query that found cards", () => {
    expect(shouldCloseCardMenu("fix ", answer([jump]))).toBe(false);
  });

  it("stays open while searching", () => {
    expect(
      shouldCloseCardMenu("foo bar", answer([], { complete: false }))
    ).toBe(false);
    expect(shouldCloseCardMenu("", answer([], { complete: false }))).toBe(
      false
    );
  });

  it("stays open for a query without a space that found nothing", () => {
    expect(shouldCloseCardMenu("foo", answer([]))).toBe(false);
  });

  it("closes when there are no recent cards to show", () => {
    expect(shouldCloseCardMenu("", answer([]))).toBe(true);
  });

  it("shows a failed search until the user carries on writing", () => {
    const failed = answer([], { complete: false, failed: true });

    expect(shouldCloseCardMenu("foo", failed)).toBe(false);
    expect(shouldCloseCardMenu("foo bar", failed)).toBe(true);
  });
});
