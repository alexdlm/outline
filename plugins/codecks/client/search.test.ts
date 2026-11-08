import type { CardSearchResults } from "./search";
import {
  isCurrentSearch,
  isEnterNewLineQuery,
  shouldCloseCardMenu,
  toSearchQuery,
} from "./search";

const results = (
  query: string,
  cards: string[] = [],
  documentId?: string
): CardSearchResults<string> => ({ query, documentId, cards });

describe("toSearchQuery", () => {
  it("trims the typed text", () => {
    expect(toSearchQuery("jump bug ")).toEqual("jump bug");
  });

  it("limits the query to the length the search accepts", () => {
    expect(toSearchQuery("a".repeat(150))).toHaveLength(100);
  });
});

describe("isCurrentSearch", () => {
  it("is false without results", () => {
    expect(isCurrentSearch(undefined, "", undefined)).toBe(false);
  });

  it("is true for the same query and document", () => {
    expect(isCurrentSearch(results("jump", [], "doc"), "jump", "doc")).toBe(
      true
    );
  });

  it("is false for another query", () => {
    expect(isCurrentSearch(results("jum"), "jump", undefined)).toBe(false);
  });

  it("is false for another document", () => {
    expect(isCurrentSearch(results("jump", [], "doc"), "jump", "other")).toBe(
      false
    );
  });
});

describe("shouldCloseCardMenu", () => {
  it.each(["5 ", "5 per hour", "199 dollars", "16a fix"])(
    "closes when a query that starts with a digit has a space: %s",
    (search) => {
      expect(
        shouldCloseCardMenu(search, results("", ["card"]), undefined)
      ).toBe(true);
    }
  );

  it.each(["5", "199", "16a"])(
    "stays open for a query that starts with a digit: %s",
    (search) => {
      expect(
        shouldCloseCardMenu(search, results("", ["card"]), undefined)
      ).toBe(false);
    }
  );

  it("closes on a space after a query that found nothing", () => {
    expect(shouldCloseCardMenu("foo ", results("foo"), undefined)).toBe(true);
    expect(shouldCloseCardMenu("foo bar", results("foo"), undefined)).toBe(
      true
    );
  });

  it("stays open on a space after a query that found cards", () => {
    expect(
      shouldCloseCardMenu("fix ", results("fix", ["card"]), undefined)
    ).toBe(false);
  });

  it("stays open on a space while the latest results answer another query", () => {
    expect(shouldCloseCardMenu("bar baz", results("foo"), undefined)).toBe(
      false
    );
  });

  it("stays open for a query without a space that found nothing", () => {
    expect(shouldCloseCardMenu("foo", results("foo"), undefined)).toBe(false);
  });

  it("closes when there are no recent cards to show", () => {
    expect(shouldCloseCardMenu("", results(""), undefined)).toBe(true);
  });

  it("stays open while recent cards have not loaded", () => {
    expect(shouldCloseCardMenu("", undefined, undefined)).toBe(false);
  });

  it("ignores results for another document", () => {
    expect(shouldCloseCardMenu("", results("", [], "doc"), "other")).toBe(
      false
    );
  });
});

describe("isEnterNewLineQuery", () => {
  it.each(["", "5", "199", "2024"])(
    "starts a new line for a bare trigger or an amount: %s",
    (query) => {
      expect(isEnterNewLineQuery(query)).toBe(true);
    }
  );

  it.each(["16a", "a16", "jump", "199 dollars"])(
    "mentions the first card for any other query: %s",
    (query) => {
      expect(isEnterNewLineQuery(query)).toBe(false);
    }
  );
});
