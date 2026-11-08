import { UnfurlResourceType, type UnfurlResponse } from "@shared/types";
import slugify from "@shared/utils/slugify";

type IssueUnfurl = UnfurlResponse[UnfurlResourceType.Issue];

/** A Codecks card reference parsed from a card URL. */
export interface CodecksCardRef {
  /** The organization's subdomain. */
  subdomain: string;
  /** The card's short id without the "$" prefix, e.g. "16a". */
  shortId: string;
  /** The card's number within the organization. */
  accountSeq: number;
}

/** Helpers for Codecks card URLs, short ids and stored snapshots. */
export class CodecksUtils {
  /**
   * Encodes a card's number as its short id.
   *
   * @param accountSeq the card's number within the organization.
   * @returns the short id without the "$" prefix, or undefined if out of range.
   */
  public static encodeShortId(accountSeq: number): string | undefined {
    if (
      !Number.isInteger(accountSeq) ||
      accountSeq < 1 ||
      accountSeq > MaxAccountSeq
    ) {
      return undefined;
    }

    const chars: string[] = [];
    let value = accountSeq + Offset + 1;
    while (value > 0) {
      const remainder = (value - 1) % Alphabet.length;
      chars.push(Alphabet[remainder]);
      value = Math.floor((value - 1) / Alphabet.length);
    }
    return chars.reverse().join("");
  }

  /**
   * Decodes a short id into the card's number.
   *
   * @param shortId the short id, with or without the "$" prefix.
   * @returns the card's number, or undefined if the short id is not valid.
   */
  public static decodeShortId(shortId: string): number | undefined {
    const code = shortId.replace(/^\$/, "").toLowerCase();
    if (!ShortIdPattern.test(code)) {
      return undefined;
    }

    let value = Alphabet.indexOf(code[0]);
    for (const char of code.slice(1)) {
      value = (value + 1) * Alphabet.length + Alphabet.indexOf(char);
    }
    value -= Offset;

    return value >= 1 && value <= MaxAccountSeq ? value : undefined;
  }

  /**
   * Parses a Codecks card URL such as https://acme.codecks.io/card/16a-title.
   *
   * @param url the URL to parse.
   * @returns the card reference, or undefined if the URL is not a card URL.
   */
  public static parseCardUrl(url: string | URL): CodecksCardRef | undefined {
    let parsed: URL;
    try {
      parsed = typeof url === "string" ? new URL(url) : url;
    } catch {
      return undefined;
    }

    if (parsed.protocol !== "https:") {
      return undefined;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.endsWith(".codecks.io")) {
      return undefined;
    }

    const subdomain = hostname.slice(0, -".codecks.io".length);
    if (
      !SubdomainPattern.test(subdomain) ||
      ReservedSubdomains.has(subdomain)
    ) {
      return undefined;
    }

    const segments = parsed.pathname.split("/");
    const cardIndex = segments.indexOf("card");
    const segment = cardIndex === -1 ? undefined : segments[cardIndex + 1];
    if (!segment) {
      return undefined;
    }

    const shortId = segment.split("-")[0].toLowerCase();
    const accountSeq = CodecksUtils.decodeShortId(shortId);
    if (accountSeq === undefined) {
      return undefined;
    }

    return { subdomain, shortId, accountSeq };
  }

  /**
   * Whether a URL is a Codecks card URL.
   *
   * @param url the URL to check.
   * @param subdomain if given, the organization the card must belong to.
   * @returns true if the URL is a card URL.
   */
  public static isCardUrl(url: string | URL, subdomain?: string): boolean {
    const ref = CodecksUtils.parseCardUrl(url);
    return !!ref && (subdomain === undefined || ref.subdomain === subdomain);
  }

  /**
   * Builds the URL of a card.
   *
   * @param subdomain the organization's subdomain.
   * @param shortId the card's short id without the "$" prefix.
   * @param title the card's title, used for the readable part of the URL.
   * @returns the card URL.
   */
  public static buildCardUrl(
    subdomain: string,
    shortId: string,
    title?: string
  ): string {
    const slug = title ? slugify(title).slice(0, 60).replace(/-+$/, "") : "";
    return `https://${subdomain}.codecks.io/card/${shortId}${slug ? `-${slug}` : ""}`;
  }

  /**
   * Reduces a card unfurl to the snapshot stored on the mention. It holds only
   * core issue fields, so it renders without the plugin and reveals nothing
   * beyond the card title, and it only changes when the card is completed or
   * reopened so that viewers don't keep rewriting the document.
   *
   * @param unfurl the card unfurl.
   * @returns the snapshot to store.
   */
  public static toSnapshot(unfurl: IssueUnfurl): IssueUnfurl {
    const closed = CodecksUtils.isClosed(unfurl);

    return {
      type: UnfurlResourceType.Issue,
      url: unfurl.url,
      id: unfurl.id,
      title: unfurl.title,
      description: null,
      author: { name: "", avatarUrl: "" },
      labels: [],
      state: {
        name: closed ? "closed" : "opened",
        color: closed ? ClosedColor : OpenedColor,
      },
      createdAt: unfurl.createdAt,
    };
  }

  /**
   * Whether a value stored on a mention is a usable issue snapshot. Stored
   * values may come from older versions or from before this plugin existed.
   *
   * @param value the stored value.
   * @returns true if the value can be rendered as an issue.
   */
  public static isSnapshot(value: unknown): value is IssueUnfurl {
    if (!value || typeof value !== "object") {
      return false;
    }

    const snapshot = value as Partial<Record<keyof IssueUnfurl, unknown>>;
    const state = snapshot.state as { name?: unknown } | null | undefined;
    return (
      snapshot.type === UnfurlResourceType.Issue &&
      typeof snapshot.url === "string" &&
      typeof snapshot.id === "string" &&
      typeof snapshot.title === "string" &&
      !!state &&
      typeof state.name === "string"
    );
  }

  /**
   * Whether a card unfurl represents a completed card.
   *
   * @param unfurl the card unfurl.
   * @returns true if the card is done.
   */
  public static isClosed(unfurl: IssueUnfurl): boolean {
    const details = unfurl.codecks;
    if (!details) {
      return unfurl.state.name === "closed";
    }
    return (
      details.status === "done" ||
      details.derivedStatus === "heroDone" ||
      details.derivedStatus === "archivedDone" ||
      details.derivedStatus === "archivedHeroDone"
    );
  }
}

// Codecks writes a card's number as bijective base 28 over this alphabet,
// offset so that every short id has at least three characters.
const Alphabet = "123456789acefghijkoqrsuvwxyz";
const Offset = 28 * 29 - 1;
const MaxAccountSeq = 2 ** 31 - 1;
const ShortIdPattern = /^[1-9acefghijkoqrsuvwxyz]{3,8}$/;
const SubdomainPattern = /^[a-z0-9-]{1,63}$/;
const ReservedSubdomains = new Set(["api", "www", "manual", "open", "mcp"]);

// Colors for the snapshot state that renders without the plugin.
const OpenedColor = "#1f75cb";
const ClosedColor = "#3fb950";
