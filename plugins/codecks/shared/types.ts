// Type aliases rather than interfaces, so they stay assignable to JSON values
// when stored in integration settings and unfurls.

/** The Codecks organization connected to a team. */
export type CodecksAccount = {
  /** The Codecks account ID. */
  id: string;
  /** The organization's display name. */
  name: string;
  /** The organization's subdomain, as in https://<subdomain>.codecks.io. */
  subdomain: string;
};

/** Grants members of a collection access to the cards of a Codecks project. */
export type CodecksMapping = {
  /** The Codecks project ID. */
  projectId: string;
  /** The project's name when the mapping was saved, for display. */
  projectName: string;
  /** The Outline collection whose members may see the project's cards. */
  collectionId: string;
  /** The deck that cards created from documents in the collection go into. */
  defaultDeckId: string | null;
};

/** A Codecks card priority: a is high, b is medium and c is low. */
export type CodecksPriority = "a" | "b" | "c";

/** The live details of a card that only the Codecks renderer uses, never persisted. */
export type CodecksCardDetails = {
  /** The card's number within the organization. */
  accountSeq: number;
  /** The card's short id without the "$" prefix, e.g. "16a". */
  shortId: string;
  /** One of not_started, started, snoozing or done, unknown values are tolerated. */
  status: string;
  /** Codecks' derived status such as blocked, review or hero, if available. */
  derivedStatus: string | null;
  priority: CodecksPriority | null;
  effort: number | null;
  isDoc: boolean;
  /** One of default, archived or deleted. */
  visibility: string;
  /** The number of sub cards, a card with any is a hero card. */
  childCount: number;
  parent: { title: string; shortId: string; url: string } | null;
  assignee: { name: string; avatarUrl: string | null } | null;
  deck: { title: string; coverColor: string | null } | null;
  project: { id: string; name: string } | null;
  milestone: { name: string; color: string | null } | null;
  lastUpdatedAt: string | null;
};

/** A deck that can be chosen as the default for new cards. */
export type CodecksDeck = {
  id: string;
  title: string;
  coverColor: string | null;
};

/** A Codecks project with its decks, as listed by codecks.projects. */
export type CodecksProject = {
  id: string;
  name: string;
  decks: CodecksDeck[];
};

/** The team's Codecks connection, as returned to admins by codecks.info. */
export type CodecksInfo = {
  integrationId: string;
  account: CodecksAccount;
  mappings: CodecksMapping[];
};

declare module "@shared/types" {
  interface EmbedIntegrationSettings {
    /** Presented to team members, never holds secrets. */
    codecks?: { account: CodecksAccount };
    /** Not presented to clients, read through codecks.info by admins. */
    codecksMappings?: CodecksMapping[];
  }

  interface IssueUnfurlExtensions {
    codecks?: CodecksCardDetails;
  }
}
