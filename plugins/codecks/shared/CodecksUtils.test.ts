import { UnfurlResourceType, type UnfurlResponse } from "@shared/types";
import { CodecksUtils } from "./CodecksUtils";

const unfurl = (
  overrides: Partial<UnfurlResponse[UnfurlResourceType.Issue]> = {}
): UnfurlResponse[UnfurlResourceType.Issue] => ({
  type: UnfurlResourceType.Issue,
  url: "https://ruiner.codecks.io/card/16a-document-how-things-work",
  id: "$16a",
  title: "Document how things work.",
  description: "Some content",
  author: { name: "Alex", avatarUrl: "https://example.com/a.png" },
  labels: [{ name: "Peon Task AI", color: "#888888" }],
  state: { name: "opened", color: "#1f75cb" },
  createdAt: "2026-11-01T00:00:00.000Z",
  codecks: {
    accountSeq: 150,
    shortId: "16a",
    status: "started",
    derivedStatus: "started",
    priority: "b",
    effort: 2,
    isDoc: false,
    visibility: "default",
    childCount: 0,
    parent: {
      title: "Peon Task AI",
      shortId: "15y",
      url: "https://ruiner.codecks.io/card/15y-peon-task-ai",
    },
    assignee: { name: "Alex", avatarUrl: "https://example.com/a.png" },
    deck: { title: "Gameplay", coverColor: "#ff8800" },
    project: { id: "p1", name: "Ruiner" },
    milestone: null,
    lastUpdatedAt: "2026-11-07T00:00:00.000Z",
  },
  ...overrides,
});

describe("CodecksUtils", () => {
  describe("short ids", () => {
    it.each([
      ["111", 1],
      ["15z", 140],
      ["16a", 150],
    ])("decodes %s as %i", (shortId, accountSeq) => {
      expect(CodecksUtils.decodeShortId(shortId)).toEqual(accountSeq);
      expect(CodecksUtils.encodeShortId(accountSeq)).toEqual(shortId);
    });

    it("accepts a $ prefix and upper case", () => {
      expect(CodecksUtils.decodeShortId("$16A")).toEqual(150);
    });

    it("round trips card numbers", () => {
      for (const accountSeq of [
        1,
        2,
        27,
        28,
        29,
        784,
        785,
        9999,
        2 ** 31 - 1,
      ]) {
        const shortId = CodecksUtils.encodeShortId(accountSeq);
        expect(shortId).toBeDefined();
        expect(CodecksUtils.decodeShortId(shortId!)).toEqual(accountSeq);
      }
    });

    it.each(["100", "5", "11", "16b", "", "$", "123456789"])(
      "rejects %s",
      (shortId) => {
        expect(CodecksUtils.decodeShortId(shortId)).toBeUndefined();
      }
    );

    it.each([0, -1, 1.5, 2 ** 31])("does not encode %s", (accountSeq) => {
      expect(CodecksUtils.encodeShortId(accountSeq)).toBeUndefined();
    });
  });

  describe("parseCardUrl", () => {
    it.each([
      "https://ruiner.codecks.io/card/16a-document-how-things-work",
      "https://ruiner.codecks.io/card/16a",
      "https://Ruiner.codecks.io/card/16A-document?tab=1#comments",
      "https://ruiner.codecks.io/decks/12-gameplay/card/16a-document",
    ])("parses %s", (url) => {
      expect(CodecksUtils.parseCardUrl(url)).toEqual({
        subdomain: "ruiner",
        shortId: "16a",
        accountSeq: 150,
      });
    });

    it.each([
      "not a url",
      "http://ruiner.codecks.io/card/16a-document",
      "https://ruiner.codecks.com/card/16a-document",
      "https://evilcodecks.io/card/16a-document",
      "https://a.b.codecks.io/card/16a-document",
      "https://open.codecks.io/card/16a-document",
      "https://api.codecks.io/card/16a-document",
      "https://ruiner.codecks.io/decks/12-gameplay",
      "https://ruiner.codecks.io/card/",
      "https://ruiner.codecks.io/card/100-document",
    ])("rejects %s", (url) => {
      expect(CodecksUtils.parseCardUrl(url)).toBeUndefined();
    });

    it("matches the organization when given", () => {
      const url = "https://ruiner.codecks.io/card/16a-document";
      expect(CodecksUtils.isCardUrl(url)).toBe(true);
      expect(CodecksUtils.isCardUrl(url, "ruiner")).toBe(true);
      expect(CodecksUtils.isCardUrl(url, "acme")).toBe(false);
    });
  });

  describe("buildCardUrl", () => {
    it("builds the URL Codecks uses for a card", () => {
      expect(
        CodecksUtils.buildCardUrl("ruiner", "16a", "Document how things work.")
      ).toEqual("https://ruiner.codecks.io/card/16a-document-how-things-work");
    });

    it("omits the slug without a title", () => {
      expect(CodecksUtils.buildCardUrl("ruiner", "16a")).toEqual(
        "https://ruiner.codecks.io/card/16a"
      );
    });

    it("builds URLs that parse back to the card", () => {
      const url = CodecksUtils.buildCardUrl("ruiner", "16a", "A ".repeat(80));
      expect(CodecksUtils.parseCardUrl(url)?.accountSeq).toEqual(150);
    });
  });

  describe("toSnapshot", () => {
    it("keeps only core issue fields", () => {
      expect(CodecksUtils.toSnapshot(unfurl())).toEqual({
        type: UnfurlResourceType.Issue,
        url: "https://ruiner.codecks.io/card/16a-document-how-things-work",
        id: "$16a",
        title: "Document how things work.",
        description: null,
        author: { name: "", avatarUrl: "" },
        labels: [],
        state: { name: "opened", color: "#1f75cb" },
        createdAt: "2026-11-01T00:00:00.000Z",
      });
    });

    it("is deterministic", () => {
      expect(CodecksUtils.toSnapshot(unfurl())).toEqual(
        CodecksUtils.toSnapshot(unfurl())
      );
    });

    it("does not change for status changes short of completion", () => {
      const blocked = unfurl();
      blocked.codecks!.derivedStatus = "blocked";
      expect(CodecksUtils.toSnapshot(blocked)).toEqual(
        CodecksUtils.toSnapshot(unfurl())
      );
    });

    it.each([
      ["done", "done"],
      ["started", "heroDone"],
      ["not_started", "archivedDone"],
    ])("is closed for status %s and derived status %s", (status, derived) => {
      const card = unfurl();
      card.codecks!.status = status;
      card.codecks!.derivedStatus = derived;
      expect(CodecksUtils.toSnapshot(card).state.name).toEqual("closed");
    });

    it("produces a valid snapshot", () => {
      expect(CodecksUtils.isSnapshot(CodecksUtils.toSnapshot(unfurl()))).toBe(
        true
      );
    });
  });

  describe("isSnapshot", () => {
    it.each([
      undefined,
      null,
      "string",
      { type: UnfurlResourceType.URL, url: "x", id: "x", title: "x" },
      { type: UnfurlResourceType.Issue, url: "x", id: "x", title: "x" },
      {
        type: UnfurlResourceType.Issue,
        url: "x",
        id: "x",
        title: "x",
        state: {},
      },
    ])("rejects %j", (value) => {
      expect(CodecksUtils.isSnapshot(value)).toBe(false);
    });
  });
});
