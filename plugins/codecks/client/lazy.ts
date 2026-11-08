import { createLazyComponent } from "~/components/LazyLoad";

/** The inline chip for card mentions, loaded when the first card renders. */
export const LazyCardChip = createLazyComponent(
  () => import("./components/CardChip"),
  { exportName: "CardChip" }
);

/**
 * The card hover preview. The chip preloads it, so the preview renders without
 * suspending and can be measured when it first opens.
 */
export const LazyCardHoverPreview = createLazyComponent(
  () => import("./components/CardHoverPreview"),
  { exportName: "CardHoverPreview" }
);
