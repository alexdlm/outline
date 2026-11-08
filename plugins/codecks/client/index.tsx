import { IntegrationService, MentionType } from "@shared/types";
import { createLazyComponent } from "~/components/LazyLoad";
import stores from "~/stores";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import { CodecksUtils } from "../shared/CodecksUtils";
import { getCodecksAccount, isConnectedCardUrl } from "./account";
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
      // Nothing about a card is stored on its mention: every detail is fetched
      // from Codecks, so viewers never rewrite a document when a card changes.
      persistedUnfurl: () => undefined,
    },
  },
  {
    ...config,
    type: Hook.MentionProvider,
    value: {
      service: IntegrationService.Codecks,
      pasteAsMention: true,
      isMentionable: isConnectedCardUrl,
      mentionType: (url, integration) =>
        isConnectedCardUrl(url, integration) ? MentionType.URL : undefined,
    },
  },
  {
    ...config,
    type: Hook.SuggestionMenu,
    value: {
      trigger: "$",
      allowSpaces: true,
      requireSearchTerm: false,
      enabledInMarks: false,
      isEnabled: () =>
        stores.integrations
          .filterByService(IntegrationService.Codecks)
          .some((integration) => !!getCodecksAccount(integration)),
      component: createLazyComponent(() => import("./components/CardMenu"), {
        exportName: "CardMenu",
      }),
    },
  },
]);
