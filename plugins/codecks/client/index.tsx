import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import { CodecksUtils } from "../shared/CodecksUtils";
import { CodecksIcon } from "./Icon";
import { LazyCardChip, LazyCardHoverPreview } from "./lazy";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Integrations",
      after: "Linear",
      icon: CodecksIcon,
      description:
        "Connect a Codecks organization to show live card previews in documents.",
      component: createLazyComponent(() => import("./Settings"), {
        exportName: "CodecksSettings",
      }),
    },
  },
  {
    ...config,
    type: Hook.IssueRenderer,
    value: {
      // Matches on the URL shape alone, so card links render as chips even
      // while the integration is disconnected or the viewer has no access.
      matches: (url: string) => CodecksUtils.isCardUrl(url),
      Mention: LazyCardChip,
      HoverPreview: LazyCardHoverPreview,
      persistedUnfurl: (unfurl) => CodecksUtils.toSnapshot(unfurl),
    },
  },
]);
