import { darken, lighten, transparentize } from "polished";
import * as React from "react";
import { useTranslation } from "react-i18next";
import type { DefaultTheme } from "styled-components";
import styled, { css } from "styled-components";
import { Backticks } from "@shared/components/Backticks";
import type { IssueMentionProps } from "@shared/editor/types";
import { stringToColor } from "@shared/utils/color";
import { sanitizeImageSrc } from "@shared/utils/urls";
import { Avatar, AvatarSize } from "~/components/Avatar";
import { CodecksUtils } from "../../shared/CodecksUtils";
import type { CodecksPriority } from "../../shared/types";
import { CodecksIcon } from "../Icon";
import { LazyCardHoverPreview } from "../lazy";
import { DeckSwatch, getDeckColor } from "./DeckSwatch";
import { getPriorityColor, getPriorityLabel } from "./priority";
import { StatusGlyph, getCardStatus, getStatusLabel } from "./StatusGlyph";

/**
 * Renders a Codecks card mention as a chip in the style of a Codecks card,
 * with priority, status, deck, parent card, short id, effort and assignee.
 * Viewers without access to the card see a plain link instead.
 *
 * @param props the mention props.
 * @returns the chip element.
 */
export function CardChip({
  attrs,
  className,
  href,
  label,
  unfurl,
  storedUnfurl,
  loaded,
}: IssueMentionProps) {
  const { t } = useTranslation();

  React.useEffect(() => {
    void LazyCardHoverPreview.preload();
  }, []);

  const card = unfurl;

  // Until this viewer's unfurl loads, or when they may not see the card, the
  // short id is shown, with the title of mentions made before this plugin.
  if (!card) {
    const snapshot = CodecksUtils.isSnapshot(storedUnfurl)
      ? storedUnfurl
      : undefined;
    const shortId = CodecksUtils.parseCardUrl(href)?.shortId;
    const id = shortId ? `$${shortId}` : undefined;
    const title =
      snapshot?.title ?? (isUrlLike(label, href) ? undefined : label);

    return (
      <PlainLink
        {...attrs}
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        aria-label={
          title
            ? [title, id].filter(Boolean).join(", ")
            : t("Codecks card {{ id }}", { id: id ?? href })
        }
        aria-busy={!loaded}
      >
        <CodecksIcon size={14} />
        {title || !id ? (
          <span>
            <Backticks content={title ?? label} />
          </span>
        ) : null}
        {id && <PlainId>{id}</PlainId>}
      </PlainLink>
    );
  }

  const details = card.codecks;
  const status = getCardStatus(details, CodecksUtils.isClosed(card));
  const priority = details?.priority ?? null;
  const parent = details?.parent ?? null;
  const assignee = details?.assignee ?? null;
  const deck = details?.deck ?? null;
  const effort = details?.effort ?? null;
  const hero = !!details && details.childCount > 0;

  const ariaLabel = [
    card.title,
    card.id,
    getStatusLabel(t, status),
    priority ? getPriorityLabel(t, priority) : undefined,
    assignee ? t("Assigned to {{ name }}", { name: assignee.name }) : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Chip
      {...attrs}
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={ariaLabel}
      $priority={priority}
      $deckColor={getDeckColor(deck?.coverColor)}
      $hero={hero}
    >
      <StatusGlyph status={status} size={14} />
      {deck && <DeckSwatch color={deck.coverColor} size={10} />}
      <Label>
        {parent && (
          <ParentPill>
            <Backticks content={parent.title} />
          </ParentPill>
        )}
        <Title $done={status === "done"} $muted={status === "archived"}>
          <Backticks content={card.title} />
        </Title>
      </Label>
      <IdBadge $hero={hero}>{card.id}</IdBadge>
      {effort !== null && (
        <Effort>
          <EffortGlyph />
          {effort}
        </Effort>
      )}
      {assignee && (
        <Avatar
          src={sanitizeImageSrc(assignee.avatarUrl)}
          model={{
            avatarUrl: null,
            name: assignee.name,
            color: stringToColor(assignee.name),
          }}
          alt={assignee.name}
          size={AvatarSize.Small}
          showTooltip
          showHoverCard={false}
        />
      )}
    </Chip>
  );
}

function isUrlLike(label: string, href: string) {
  return !label || label === href || /^https?:\/\//i.test(label);
}

function EffortGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="6" width="2.5" height="3.5" rx="0.75" />
      <rect x="3.75" y="3.5" width="2.5" height="6" rx="0.75" />
      <rect x="7" y="0.5" width="2.5" height="9" rx="0.75" />
    </svg>
  );
}

interface ChipProps {
  $priority: CodecksPriority | null;
  $deckColor: string | undefined;
  $hero: boolean;
}

function getChipShadow({
  $priority,
  $deckColor,
  $hero,
  theme,
}: ChipProps & { theme: DefaultTheme }) {
  const shadows: string[] = [];
  const priorityColor = getPriorityColor($priority, theme);
  if (priorityColor) {
    shadows.push(`inset 3px 0 0 0 ${priorityColor}`);
  }
  if ($hero) {
    shadows.push(`inset 0 0 0 1px ${transparentize(0.25, theme.yellow)}`);
  } else if ($deckColor) {
    shadows.push(`inset 0 0 0 1px ${transparentize(0.55, $deckColor)}`);
  }
  return shadows.length ? shadows.join(", ") : "none";
}

const pill = css`
  padding: 0 5px;
  border-radius: 4px;
  font-size: 0.85em;
  color: ${(props) => props.theme.textSecondary};
  background: ${(props) => transparentize(0.85, props.theme.textTertiary)};
`;

const Label = styled.span``;

const ParentPill = styled.span`
  ${pill}
`;

const Title = styled.span<{ $done: boolean; $muted: boolean }>`
  ${(props) =>
    props.$done || props.$muted ? `color: ${props.theme.textTertiary};` : ""}
  ${(props) => (props.$done ? "text-decoration: line-through;" : "")}
`;

const IdBadge = styled.span<{ $hero: boolean }>`
  padding: 0 4px;
  border-radius: 4px;
  font-family: ${(props) => props.theme.fontFamilyMono};
  font-size: 0.85em;
  color: ${(props) =>
    props.$hero
      ? props.theme.isDark
        ? props.theme.yellow
        : darken(0.18, props.theme.yellow)
      : props.theme.isDark
        ? lighten(0.25, props.theme.accent)
        : props.theme.accent};
  background: ${(props) =>
    transparentize(
      0.86,
      props.$hero ? props.theme.yellow : props.theme.accent
    )};
`;

const Effort = styled.span`
  ${pill}
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-variant-numeric: tabular-nums;
`;

const PlainId = styled.span`
  color: ${(props) => props.theme.textTertiary};
`;

// The editor styles mentions through its container class, so the chip repeats
// its own class to take precedence. Every descendant span of a link mention
// is truncated and every span after the first never shrinks, so the parent
// pill and title share one span and the rules below let both shrink in it.
const Chip = styled.a<ChipProps>`
  &&& {
    gap: 5px;
    padding-left: ${(props) => (props.$priority ? 8 : 4)}px;
    box-shadow: ${getChipShadow};

    ${Label} {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    ${ParentPill} {
      flex: 0 1 auto;
      min-width: 1.5em;
      max-width: 45%;
    }

    ${Title} {
      flex: 0 1 auto;
    }
  }
`;

const PlainLink = styled.a`
  &&& {
    gap: 5px;
  }
`;
