import { createLazyComponent } from "~/components/LazyLoad";
import stores from "~/stores";
import { Hook, PluginManager } from "./PluginManager";

const SettingsComponent = () => null;
const Icon = () => null;
const component = createLazyComponent(async () => ({
  default: SettingsComponent,
}));

describe("PluginManager", () => {
  it("returns registered hooks from observable plugin arrays", () => {
    PluginManager.add([
      {
        id: "test-settings-plugin-low",
        name: "Low priority plugin",
        type: Hook.Settings,
        priority: 20,
        value: {
          group: "Integrations",
          icon: Icon,
          component,
        },
      },
      {
        id: "test-settings-plugin-high",
        name: "High priority plugin",
        type: Hook.Settings,
        priority: 10,
        value: {
          group: "Integrations",
          icon: Icon,
          component,
        },
      },
    ]);

    const hooks = PluginManager.getHooks(Hook.Settings).filter((plugin) =>
      plugin.id.startsWith("test-settings-plugin")
    );

    expect(hooks.map((plugin) => plugin.id)).toEqual([
      "test-settings-plugin-high",
      "test-settings-plugin-low",
    ]);
  });

  it("returns registered issue renderers", () => {
    const Mention = createLazyComponent(async () => ({ default: () => null }));
    const HoverPreview = createLazyComponent(async () => ({
      default: () => null,
    }));
    const matches = (url: string) => url.startsWith("https://example.com/");

    PluginManager.add({
      id: "test-issue-renderer",
      name: "Issue renderer",
      type: Hook.IssueRenderer,
      value: { matches, Mention, HoverPreview },
    });

    const hook = PluginManager.getHooks(Hook.IssueRenderer).find(
      (plugin) => plugin.id === "test-issue-renderer"
    );

    expect(hook?.value.matches("https://example.com/card")).toBe(true);
    expect(hook?.value.Mention).toBe(Mention);
    expect(hook?.value.HoverPreview).toBe(HoverPreview);
  });

  it("finds the first issue renderer that matches a URL", () => {
    const renderer = {
      matches: (url: string) => url.startsWith("https://renderer.test/"),
      Mention: createLazyComponent(async () => ({ default: () => null })),
      HoverPreview: createLazyComponent(async () => ({
        default: () => null,
      })),
    };
    const throwing = {
      ...renderer,
      matches: (): boolean => {
        throw new Error("Broken matcher");
      },
    };

    PluginManager.add([
      {
        id: "test-throwing-renderer",
        name: "Throwing renderer",
        type: Hook.IssueRenderer,
        priority: -1,
        value: throwing,
      },
      {
        id: "test-matching-renderer",
        name: "Matching renderer",
        type: Hook.IssueRenderer,
        value: renderer,
      },
      {
        id: "test-later-renderer",
        name: "Later renderer",
        type: Hook.IssueRenderer,
        priority: 1,
        value: { ...renderer },
      },
    ]);

    expect(stores.unfurls.getIssueRenderer("https://renderer.test/1")).toBe(
      renderer
    );
    expect(
      stores.unfurls.getIssueRenderer("https://other.test/1")
    ).toBeUndefined();
    expect(stores.unfurls.getIssueRenderer("")).toBeUndefined();
    expect(stores.unfurls.getIssueRenderer(undefined)).toBeUndefined();
  });

  it("loads the plugin modules once", async () => {
    const loading = PluginManager.loadPlugins();

    expect(PluginManager.loadPlugins()).toBe(loading);
    await expect(loading).resolves.toBeUndefined();
    expect(PluginManager.isLoaded).toBe(true);
  });
});
