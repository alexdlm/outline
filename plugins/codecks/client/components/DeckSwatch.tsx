import { useTheme } from "styled-components";
import { stringToColor, validateColorHex } from "@shared/utils/color";

interface Props {
  /** The deck's cover color as returned by Codecks, which may be missing. */
  color: string | null | undefined;
  /** The deck's title, which picks a color for decks without one. */
  title?: string;
  /** The size of the swatch in pixels. */
  size?: number;
  /** Optional class name. */
  className?: string;
}

/**
 * Returns a deck's color, safe to pass to color functions. Decks without a
 * cover color get one picked from a palette by their title, so each deck keeps
 * a recognizable color until one is set in Codecks. Codecks marks the cover
 * color as a preview field, so its format is checked.
 *
 * @param color the cover color from Codecks.
 * @param title the deck's title.
 * @returns the color, or undefined without a valid cover color or a title.
 */
export function getDeckColor(color: string | null | undefined, title?: string) {
  if (color && validateColorHex(color)) {
    return color;
  }
  return title ? stringToColor(title) : undefined;
}

/**
 * A small rounded square in a deck's cover color, or an outline when the deck
 * has none. It is decorative, so the deck name must be shown alongside it.
 *
 * @param props the swatch props.
 * @returns the swatch element.
 */
export function DeckSwatch({ color, title, size = 10, className }: Props) {
  const theme = useTheme();
  const fill = getDeckColor(color, title);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0.5"
        y="0.5"
        width="9"
        height="9"
        rx="2.5"
        fill={fill ?? "none"}
        stroke={fill ? theme.text : theme.textTertiary}
        strokeOpacity={fill ? 0.15 : 1}
        strokeWidth="1"
      />
    </svg>
  );
}
