interface Props {
  /** The size of the icon, 24px is default to match standard icons. */
  size?: number;
  /** The color of the icon, defaults to the current text color. */
  fill?: string;
  /** Optional class name. */
  className?: string;
}

/**
 * A pair of stacked cards, used wherever Codecks is represented.
 *
 * @param props the icon props.
 * @returns the icon element.
 */
export function CodecksIcon({
  size = 24,
  fill = "currentColor",
  className,
}: Props) {
  return (
    <svg
      fill={fill}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8.5" y="3" width="11" height="14" rx="2" fillOpacity="0.45" />
      <rect x="4.5" y="7" width="11" height="14" rx="2" />
    </svg>
  );
}
