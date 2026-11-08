import { IntegrationService } from "@shared/types";
import { Minute } from "@shared/utils/time";
import {
  Hook,
  PluginManager,
  PluginPriority,
} from "@server/utils/PluginManager";
import config from "../plugin.json";
import { router } from "./api/codecks";
import { Codecks } from "./codecks";
import { uninstall } from "./uninstall";

PluginManager.add([
  {
    type: Hook.IntegrationSettings,
    value: { service: IntegrationService.Codecks, keys: ["codecks"] },
  },
  {
    ...config,
    type: Hook.API,
    value: router,
  },
  {
    type: Hook.UnfurlProvider,
    name: "Codecks",

    // Card URLs must never fall through to generic providers such as Iframely.
    priority: PluginPriority.High,
    value: { unfurl: Codecks.unfurl, cacheExpiry: Minute.seconds },
  },
  {
    type: Hook.Uninstall,
    value: uninstall,
  },
]);
