import { UnfurlResourceType, type UnfurlResponse } from "@shared/types";
import type { Integration } from "@server/models";
import { CodecksUtils } from "../shared/CodecksUtils";
import type {
  CodecksAccount,
  CodecksCardDetails,
  CodecksInfo,
  CodecksPriority,
} from "../shared/types";
import type { CodecksCard } from "./codecks";
import { getCodecksMappings } from "./gate";

type IssueUnfurl = UnfurlResponse[UnfurlResourceType.Issue];

/**
 * Presents a card as an issue unfurl. The core fields stay generic so that
 * other renderers can show the card, the details are under `codecks`.
 *
 * @param card the card.
 * @param subdomain the subdomain of the card's organization.
 * @returns the issue unfurl.
 */
export function presentCard(card: CodecksCard, subdomain: string): IssueUnfurl {
  const shortId = shortIdOf(card.accountSeq);
  const unfurl: IssueUnfurl = {
    type: UnfurlResourceType.Issue,
    url: CodecksUtils.buildCardUrl(subdomain, shortId, card.title),
    id: `$${shortId}`,
    title: card.title,
    description: presentDescription(card.content),
    author: { name: "", avatarUrl: "" },
    labels: [],
    state: { name: "opened", color: "" },
    createdAt: card.createdAt ?? new Date(0).toISOString(),
    codecks: presentDetails(card, subdomain, shortId),
  };

  // The state is the coarse one stored on mentions, so a stored snapshot
  // matches what was shown and only changes when the card is completed.
  return { ...unfurl, state: CodecksUtils.toSnapshot(unfurl).state };
}

/**
 * Presents the team's Codecks connection to an admin.
 *
 * @param integration the Codecks integration.
 * @param account the connected organization.
 * @returns the connection details.
 */
export function presentInfo(
  integration: Integration,
  account: CodecksAccount
): CodecksInfo {
  return {
    integrationId: integration.id,
    account,
    mappings: getCodecksMappings(integration) ?? [],
  };
}

/** The longest description included in an unfurl, in characters. */
const DescriptionMaxLength = 1000;

const Priorities: CodecksPriority[] = ["a", "b", "c"];

const HexColorPattern = /^#[0-9a-f]{3,8}$/i;

const ColorNamePattern = /^[a-z]{1,20}$/i;

function presentDetails(
  card: CodecksCard,
  subdomain: string,
  shortId: string
): CodecksCardDetails {
  const { assignee, deck, milestone, parent } = card;
  const parentShortId = parent
    ? CodecksUtils.encodeShortId(parent.accountSeq)
    : undefined;

  return {
    accountSeq: card.accountSeq,
    shortId,
    status: card.status,
    derivedStatus: card.derivedStatus,
    priority: Priorities.find((priority) => priority === card.priority) ?? null,
    effort: card.effort,
    isDoc: card.isDoc,
    visibility: card.visibility,
    childCount: card.childCount,
    parent:
      parent && parentShortId
        ? {
            title: parent.title,
            shortId: parentShortId,
            url: CodecksUtils.buildCardUrl(
              subdomain,
              parentShortId,
              parent.title
            ),
          }
        : null,
    assignee: assignee
      ? {
          name: assignee.fullName || assignee.name || "",
          avatarUrl: httpsUrl(assignee.avatarUrl),
        }
      : null,
    deck: deck
      ? { title: deck.title, coverColor: hexColor(deck.coverColor) }
      : null,
    project: card.project
      ? { id: card.project.id, name: card.project.name }
      : null,
    milestone: milestone
      ? {
          name: milestone.name,
          color:
            hexColor(milestone.color) ??
            (milestone.color && ColorNamePattern.test(milestone.color)
              ? milestone.color
              : null),
        }
      : null,
    lastUpdatedAt: card.lastUpdatedAt,
  };
}

function presentDescription(content: string): string | null {
  const body = content.split(/\r?\n/).slice(1).join("\n").trim();
  if (!body) {
    return null;
  }
  return body.length > DescriptionMaxLength
    ? `${body.slice(0, DescriptionMaxLength).trimEnd()}…`
    : body;
}

function shortIdOf(accountSeq: number): string {
  return CodecksUtils.encodeShortId(accountSeq) ?? String(accountSeq);
}

function httpsUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function hexColor(value: string | null): string | null {
  return value && HexColorPattern.test(value) ? value : null;
}
