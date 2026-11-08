import { useTheme } from "styled-components";
import { validateColorHex } from "@shared/utils/color";

interface Props {
  /** The deck's cover color as returned by Codecks, which may be missing. */
  color: string | null | undefined;
  /** The size of the swatch in pixels. */
  size?: number;
  /** Optional class name. */
  className?: string;
}

/**
 * Returns a deck cover color that is safe to pass to color functions, Codecks
 * marks the field as a preview so its format is not guaranteed.
 *
 * @param color the cover color from Codecks.
 * @returns the color, or undefined if it is missing or not a hex color.
 */
export function getDeckColor(color: string | null | undefined) {
  return color && validateColorHex(color) ? color : undefined;
}

/**
 * A small rounded square in a deck's cover color, or an outline when the deck
 * has none. It is decorative, so the deck name must be shown alongside it.
 *
 * @param props the swatch props.
 * @returns the swatch element.
 */
export function DeckSwatch({ color, size = 10, className }: Props) {
  const theme = useTheme();
  const fill = getDeckColor(color);

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
