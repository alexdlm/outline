import type { TFunction } from "i18next";
import { mix } from "polished";
import type { DefaultTheme } from "styled-components";
import { useTheme } from "styled-components";
import type { CodecksCardDetails } from "../../shared/types";

/** The states a card is displayed in, coarser than Codecks' own statuses. */
export type CardStatus =
  | "open"
  | "started"
  | "blocked"
  | "review"
  | "done"
  | "snoozed"
  | "doc"
  | "hero"
  | "archived";

/**
 * Works out how a card is displayed. Codecks may add derived statuses, so
 * unknown values fall back to the card's workflow status.
 *
 * @param details the live card details, if available.
 * @param closed whether the card is done.
 * @returns the display status.
 */
export function getCardStatus(
  details: CodecksCardDetails | null | undefined,
  closed: boolean
): CardStatus {
  if (!details) {
    return closed ? "done" : "open";
  }

  // A finished card reads as done even once archived.
  if (closed) {
    return "done";
  }

  const derived = details.derivedStatus ?? "";
  if (
    details.visibility === "archived" ||
    details.visibility === "deleted" ||
    derived === "deleted" ||
    derived.startsWith("archived")
  ) {
    return "archived";
  }

  switch (derived) {
    case "blocked":
      return "blocked";
    case "review":
      return "review";
    case "doc":
    case "heroDoc":
      return "doc";
    case "snoozing":
      return "snoozed";
    case "started":
      return "started";
    case "hero":
      // Only cards with sub cards are shown as hero cards.
      if (details.childCount > 0) {
        return "hero";
      }
      break;
  }

  if (details.isDoc) {
    return "doc";
  }
  if (details.status === "snoozing") {
    return "snoozed";
  }
  if (details.status === "started") {
    return "started";
  }
  return "open";
}

/**
 * The theme color of a card status.
 *
 * @param status the display status.
 * @param theme the current theme.
 * @returns a color.
 */
export function getStatusColor(
  status: CardStatus,
  theme: DefaultTheme
): string {
  switch (status) {
    case "started":
      return theme.accent;
    case "blocked":
      return theme.danger;
    case "review":
      return theme.brand.marine;
    case "done":
      return theme.success;
    case "hero":
      return theme.yellow;
    case "doc":
      return theme.textSecondary;
    case "snoozed":
    case "archived":
    case "open":
    default:
      return theme.textTertiary;
  }
}

/**
 * A readable name for a card status.
 *
 * @param t the translation function.
 * @param status the display status.
 * @returns the translated name.
 */
export function getStatusLabel(t: TFunction, status: CardStatus): string {
  switch (status) {
    case "started":
      return t("Started");
    case "blocked":
      return t("Blocked");
    case "review":
      return t("In review");
    case "done":
      return t("Done");
    case "snoozed":
      return t("Snoozed");
    case "doc":
      return t("Doc card");
    case "hero":
      return t("Hero card");
    case "archived":
      return t("Archived");
    case "open":
    default:
      return t("Not started");
  }
}

interface Props {
  /** The display status. */
  status: CardStatus;
  /** The size of the glyph in pixels. */
  size?: number;
  /** Optional class name. */
  className?: string;
}

/**
 * A small glyph showing a card's status in its status color. It is decorative,
 * so the status must also be conveyed in text by the parent.
 *
 * @param props the glyph props.
 * @returns the glyph element.
 */
export function StatusGlyph({ status, size = 14, className }: Props) {
  const theme = useTheme();
  const color = getStatusColor(status, theme);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {renderShape(status, color, theme)}
    </svg>
  );
}

function renderShape(status: CardStatus, color: string, theme: DefaultTheme) {
  const ring = (
    <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
  );

  switch (status) {
    case "started":
      return (
        <>
          {ring}
          <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill={color} />
        </>
      );
    case "review":
      return (
        <>
          {ring}
          <path d="M8 4.5a3.5 3.5 0 1 1-3.5 3.5H8z" fill={color} />
        </>
      );
    case "done":
      return (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path
            d="M5 8.25 7 10.25 11 6"
            fill="none"
            stroke={theme.white}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "blocked":
      return (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <rect
            x="4.5"
            y="7.125"
            width="7"
            height="1.75"
            rx="0.875"
            fill={theme.white}
          />
        </>
      );
    case "snoozed":
      return (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray="2.4 2"
        />
      );
    case "doc":
      return (
        <>
          <path
            d="M4 2.75h5l3 3v7.5H4z"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M6 8.5h4M6 11h4"
            stroke={color}
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </>
      );
    case "hero":
      return (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill={mix(0.75, theme.background, color)}
            stroke={color}
            strokeWidth="1.5"
          />
          <path
            d="M8 5 9 7.1l2.25.3-1.65 1.55.4 2.25L8 10.1l-2 1.1.4-2.25L4.75 7.4 7 7.1z"
            fill={color}
          />
        </>
      );
    case "archived":
      return (
        <>
          <rect
            x="2.5"
            y="3"
            width="11"
            height="3"
            rx="1"
            fill="none"
            stroke={color}
            strokeWidth="1.25"
          />
          <path
            d="M3.5 6v6a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V6M6.5 8.75h3"
            fill="none"
            stroke={color}
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </>
      );
    case "open":
    default:
      return ring;
  }
}
