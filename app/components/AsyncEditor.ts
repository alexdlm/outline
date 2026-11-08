import lazyWithRetry from "@shared/utils/lazyWithRetry";
import { PluginManager } from "~/utils/PluginManager";

/**
 * The editor core is the largest chunk in the app and is kept out of the
 * initial bundle. This module stays light so routes can preload the chunk
 * without pulling editor dependencies into their own chunk.
 *
 * Loading also waits for client plugins, so that the renderers they register
 * are in place before any mention unfurls and stores its data on the node.
 */
const AsyncEditor = lazyWithRetry(() =>
  Promise.all([
    // oxlint-disable-next-line no-restricted-imports -- the one place the chunk is loaded
    import("~/editor"),
    PluginManager.loadPlugins().catch(() => undefined),
  ]).then(([module]) => module)
);

export default AsyncEditor;
