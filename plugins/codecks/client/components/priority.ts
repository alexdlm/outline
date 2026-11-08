import type { TFunction } from "i18next";
import { mix } from "polished";
import type { DefaultTheme } from "styled-components";
import type { CodecksPriority } from "../../shared/types";

/**
 * A readable name for a card priority.
 *
 * @param t the translation function.
 * @param priority the Codecks priority, a is high and c is low.
 * @returns the translated name.
 */
export function getPriorityLabel(
  t: TFunction,
  priority: CodecksPriority
): string {
  switch (priority) {
    case "a":
      return t("High priority");
    case "b":
      return t("Medium priority");
    case "c":
    default:
      return t("Low priority");
  }
}

/**
 * The theme color of a card priority.
 *
 * @param priority the Codecks priority, or null for none.
 * @param theme the current theme.
 * @returns a color, or undefined when the card has no priority.
 */
export function getPriorityColor(
  priority: CodecksPriority | null,
  theme: DefaultTheme
): string | undefined {
  switch (priority) {
    case "a":
      return theme.danger;
    case "b":
      return theme.warning;
    case "c":
      return mix(0.5, theme.accent, theme.textTertiary);
    default:
      return undefined;
  }
}
