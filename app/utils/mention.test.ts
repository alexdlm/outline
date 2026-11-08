import { v4 as uuidv4 } from "uuid";
import {
  IntegrationService,
  IntegrationType,
  MentionType,
} from "@shared/types";
import Integration from "~/models/Integration";
import stores from "~/stores";
import {
  determineMentionType,
  getMentionProvider,
  getPasteMentionType,
  getPasteMentionTypes,
  isURLMentionable,
} from "./mention";
import type { Plugin } from "./PluginManager";
import { Hook, PluginManager } from "./PluginManager";

type MentionProvider = Plugin<Hook.MentionProvider>["value"];

const cardUrl = new URL("https://acme.codecks.io/card/16a-a-card");

const cardProvider: MentionProvider = {
  service: IntegrationService.Codecks,
  pasteAsMention: true,
  isMentionable: (url) => url.hostname === "acme.codecks.io",
  mentionType: (url) =>
    url.pathname.startsWith("/card/") ? MentionType.URL : undefined,
};

function buildIntegration(
  service: IntegrationService,
  settings: Record<string, unknown> = {}
): Integration {
  return new Integration(
    { id: uuidv4(), type: IntegrationType.Embed, service, settings },
    stores.integrations
  );
}

/**
 * Stubs the registered mention providers for one test, so nothing is added to
 * the plugin registry that other tests share.
 */
function useProviders(...providers: MentionProvider[]) {
  return vi.spyOn(PluginManager, "getHooks").mockReturnValue(
    providers.map((value, index) => ({
      id: `test-mention-provider-${index}`,
      name: "Test mention provider",
      type: Hook.MentionProvider,
      priority: 0,
      value,
    }))
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getMentionProvider", () => {
  it("finds the provider registered for the integration's service", () => {
    const spy = useProviders(
      { ...cardProvider, service: IntegrationService.Linear },
      cardProvider
    );

    expect(
      getMentionProvider(buildIntegration(IntegrationService.Codecks))
    ).toBe(cardProvider);
    expect(spy).toHaveBeenCalledWith(Hook.MentionProvider);
  });

  it("returns undefined when no provider handles the service", () => {
    useProviders(cardProvider);

    expect(
      getMentionProvider(buildIntegration(IntegrationService.GitHub))
    ).toBeUndefined();
  });

  it("finds a provider registered with the plugin manager", () => {
    const provider: MentionProvider = { ...cardProvider };
    PluginManager.add({
      id: "test-registered-mention-provider",
      name: "Registered mention provider",
      type: Hook.MentionProvider,
      value: provider,
    });

    const hook = PluginManager.getHooks(Hook.MentionProvider).find(
      (plugin) => plugin.id === "test-registered-mention-provider"
    );

    expect(hook?.priority).toBe(0);
    expect(
      getMentionProvider(buildIntegration(IntegrationService.Codecks))
    ).toBe(provider);
  });
});

describe("isURLMentionable and determineMentionType", () => {
  it("use the built in rules when no provider is registered", () => {
    useProviders();
    const github = buildIntegration(IntegrationService.GitHub);
    const linear = buildIntegration(IntegrationService.Linear, {
      linear: { workspace: { key: "acme" } },
    });
    const gitlab = buildIntegration(IntegrationService.GitLab, {
      gitlab: { url: "https://git.example.com" },
    });
    const issue = new URL("https://github.com/outline/outline/issues/1");
    const pull = new URL("https://github.com/outline/outline/pull/2");

    expect(isURLMentionable({ url: issue, integration: github })).toBe(true);
    expect(determineMentionType({ url: issue, integration: github })).toBe(
      MentionType.Issue
    );
    expect(determineMentionType({ url: pull, integration: github })).toBe(
      MentionType.PullRequest
    );

    const linearIssue = new URL("https://linear.app/acme/issue/ENG-1/title");
    expect(isURLMentionable({ url: linearIssue, integration: linear })).toBe(
      true
    );
    expect(
      isURLMentionable({
        url: new URL("https://linear.app/other/issue/ENG-1/title"),
        integration: linear,
      })
    ).toBe(false);
    expect(
      determineMentionType({ url: linearIssue, integration: linear })
    ).toBe(MentionType.Issue);

    const mergeRequest = new URL(
      "https://git.example.com/group/project/-/merge_requests/3"
    );
    expect(isURLMentionable({ url: mergeRequest, integration: gitlab })).toBe(
      true
    );
    expect(
      determineMentionType({ url: mergeRequest, integration: gitlab })
    ).toBe(MentionType.PullRequest);
  });

  it("rejects URLs that do not belong to the integration", () => {
    useProviders();
    const github = buildIntegration(IntegrationService.GitHub);
    const codecks = buildIntegration(IntegrationService.Codecks);

    expect(
      isURLMentionable({
        url: new URL("https://example.com/outline/outline/issues/1"),
        integration: github,
      })
    ).toBe(false);
    expect(isURLMentionable({ url: cardUrl, integration: codecks })).toBe(
      false
    );
    expect(
      determineMentionType({ url: cardUrl, integration: codecks })
    ).toBeUndefined();
  });

  it("consult the provider before the built in rules", () => {
    useProviders({
      service: IntegrationService.GitHub,
      isMentionable: (url) => url.pathname.startsWith("/acme/"),
      mentionType: () => MentionType.Project,
    });
    const github = buildIntegration(IntegrationService.GitHub);
    const issue = new URL("https://github.com/outline/outline/issues/1");

    expect(isURLMentionable({ url: issue, integration: github })).toBe(false);
    expect(
      isURLMentionable({
        url: new URL("https://github.com/acme/repo/issues/1"),
        integration: github,
      })
    ).toBe(true);
    expect(determineMentionType({ url: issue, integration: github })).toBe(
      MentionType.Project
    );
  });

  it("keep the built in rules for services without a provider", () => {
    useProviders(cardProvider);
    const github = buildIntegration(IntegrationService.GitHub);
    const codecks = buildIntegration(IntegrationService.Codecks);
    const issue = new URL("https://github.com/outline/outline/issues/1");

    expect(isURLMentionable({ url: issue, integration: github })).toBe(true);
    expect(determineMentionType({ url: issue, integration: github })).toBe(
      MentionType.Issue
    );
    expect(isURLMentionable({ url: cardUrl, integration: codecks })).toBe(true);
    expect(determineMentionType({ url: cardUrl, integration: codecks })).toBe(
      MentionType.URL
    );
  });

  it("treat a provider that throws as not matching", () => {
    useProviders({
      service: IntegrationService.Codecks,
      isMentionable: () => {
        throw new Error("Broken provider");
      },
      mentionType: () => {
        throw new Error("Broken provider");
      },
    });
    const codecks = buildIntegration(IntegrationService.Codecks);

    expect(isURLMentionable({ url: cardUrl, integration: codecks })).toBe(
      false
    );
    expect(
      determineMentionType({ url: cardUrl, integration: codecks })
    ).toBeUndefined();
  });
});

describe("getPasteMentionType", () => {
  it("returns the provider's mention type for a mentionable URL", () => {
    useProviders(cardProvider);

    expect(
      getPasteMentionType(cardUrl, [
        buildIntegration(IntegrationService.GitHub),
        buildIntegration(IntegrationService.Codecks),
      ])
    ).toBe(MentionType.URL);
  });

  it("ignores providers that do not paste as mentions", () => {
    useProviders({ ...cardProvider, pasteAsMention: false });
    const codecks = buildIntegration(IntegrationService.Codecks);

    expect(isURLMentionable({ url: cardUrl, integration: codecks })).toBe(true);
    expect(getPasteMentionType(cardUrl, [codecks])).toBeUndefined();
  });

  it("never pastes URLs handled by the built in rules as mentions", () => {
    useProviders(cardProvider);

    expect(
      getPasteMentionType(
        new URL("https://github.com/outline/outline/issues/1"),
        [buildIntegration(IntegrationService.GitHub)]
      )
    ).toBeUndefined();
  });

  it("returns undefined for URLs the provider does not recognize", () => {
    useProviders(cardProvider);
    const integrations = [buildIntegration(IntegrationService.Codecks)];

    expect(
      getPasteMentionType(new URL("https://example.com/card/16a"), integrations)
    ).toBeUndefined();
    expect(
      getPasteMentionType(
        new URL("https://other.codecks.io/card/16a-a-card"),
        integrations
      )
    ).toBeUndefined();
    expect(
      getPasteMentionType(
        new URL("https://acme.codecks.io/decks/1-deck"),
        integrations
      )
    ).toBeUndefined();
  });

  it("returns undefined without a matching integration", () => {
    useProviders(cardProvider);

    expect(getPasteMentionType(cardUrl, [])).toBeUndefined();
    expect(
      getPasteMentionType(cardUrl, [
        buildIntegration(IntegrationService.Linear),
      ])
    ).toBeUndefined();
  });

  it("returns undefined when the provider throws", () => {
    useProviders({
      ...cardProvider,
      isMentionable: () => {
        throw new Error("Broken provider");
      },
    });

    expect(
      getPasteMentionType(cardUrl, [
        buildIntegration(IntegrationService.Codecks),
      ])
    ).toBeUndefined();
  });
});

describe("getPasteMentionTypes", () => {
  const otherCardUrl = "https://acme.codecks.io/card/16b-another-card";

  it("returns the mention type of every URL when all of them are mentions", () => {
    useProviders(cardProvider);

    expect(
      getPasteMentionTypes(
        [cardUrl.href, otherCardUrl],
        [buildIntegration(IntegrationService.Codecks)]
      )
    ).toEqual({
      [cardUrl.href]: MentionType.URL,
      [otherCardUrl]: MentionType.URL,
    });
  });

  it("returns undefined when any URL is pasted as a link", () => {
    useProviders(cardProvider);

    expect(
      getPasteMentionTypes(
        [cardUrl.href, "https://example.com/page"],
        [buildIntegration(IntegrationService.Codecks)]
      )
    ).toBeUndefined();
  });

  it("returns undefined for text that is not a URL", () => {
    useProviders(cardProvider);

    expect(
      getPasteMentionTypes(
        [cardUrl.href, "not a url"],
        [buildIntegration(IntegrationService.Codecks)]
      )
    ).toBeUndefined();
  });

  it("returns undefined without URLs", () => {
    useProviders(cardProvider);

    expect(
      getPasteMentionTypes([], [buildIntegration(IntegrationService.Codecks)])
    ).toBeUndefined();
  });
});
