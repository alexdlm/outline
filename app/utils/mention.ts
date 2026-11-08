import type { IntegrationSettings, IntegrationType } from "@shared/types";
import { IntegrationService, MentionType } from "@shared/types";
import type Integration from "~/models/Integration";
import type { Plugin } from "~/utils/PluginManager";
import { Hook, PluginManager } from "~/utils/PluginManager";

type MentionProvider = Plugin<Hook.MentionProvider>["value"];

const gitlabSystemPaths = new Set([
  "explore",
  "help",
  "admin",
  "dashboard",
  "users",
  "groups",
  "projects",
  "snippets",
  "search",
  "-",
]);

/**
 * Finds the mention provider that a plugin registered for the integration's
 * service.
 *
 * @param integration the integration to find a provider for.
 * @returns the provider, or undefined if no plugin handles the service.
 */
export function getMentionProvider(
  integration: Integration
): MentionProvider | undefined {
  return PluginManager.getHooks(Hook.MentionProvider).find(
    (hook) => hook.value.service === integration.service
  )?.value;
}

/**
 * Finds the mention type that a pasted URL is inserted as directly, skipping
 * the paste menu. Only providers that opt in with `pasteAsMention` are
 * consulted.
 *
 * @param url the pasted URL.
 * @param integrations the integrations available to the current user.
 * @returns the mention type, or undefined if the URL should be pasted as a link.
 */
export function getPasteMentionType(
  url: URL,
  integrations: Integration[]
): MentionType | undefined {
  for (const integration of integrations) {
    const provider = getMentionProvider(integration);
    if (
      provider?.pasteAsMention &&
      callProvider(() => provider.isMentionable(url, integration), false)
    ) {
      return callProvider(
        () => provider.mentionType(url, integration),
        undefined
      );
    }
  }

  return undefined;
}

/**
 * Finds the mention types that pasted URLs are inserted as directly, skipping
 * the paste menu. They are only inserted as mentions when every one of them
 * is, so that a list mixing them with other links keeps the menu.
 *
 * @param hrefs the pasted URLs.
 * @param integrations the integrations available to the current user.
 * @returns the mention type of each URL, or undefined if any URL should be
 * pasted as a link.
 */
export function getPasteMentionTypes(
  hrefs: string[],
  integrations: Integration[]
): Record<string, MentionType> | undefined {
  if (hrefs.length === 0) {
    return undefined;
  }

  const types: Record<string, MentionType> = {};
  for (const href of hrefs) {
    const url = parseUrl(href);
    const type = url ? getPasteMentionType(url, integrations) : undefined;
    if (!type) {
      return undefined;
    }
    types[href] = type;
  }

  return types;
}

/**
 * Checks whether a URL can be converted to a mention for the given
 * integration.
 *
 * @param options the URL and integration to check against.
 * @returns true if the URL can be mentioned through the integration.
 */
export const isURLMentionable = ({
  url,
  integration,
}: {
  url: URL;
  integration: Integration;
}): boolean => {
  const provider = getMentionProvider(integration);
  if (provider) {
    return callProvider(() => provider.isMentionable(url, integration), false);
  }

  const { hostname, pathname } = url;

  switch (integration.service) {
    case IntegrationService.GitHub: {
      return hostname === "github.com";
    }

    case IntegrationService.Linear: {
      const pathParts = pathname.split("/");
      const settings =
        integration.settings as IntegrationSettings<IntegrationType.Embed>;

      return (
        hostname === "linear.app" &&
        settings.linear?.workspace.key === pathParts[1] // ensure installed workspace key matches with the provided url.
      );
    }

    case IntegrationService.GitLab: {
      const settings =
        integration.settings as IntegrationSettings<IntegrationType.Embed>;
      let gitlabHostname: string | undefined;
      try {
        gitlabHostname = settings.gitlab?.url
          ? new URL(settings.gitlab.url).hostname
          : undefined;
      } catch {
        // Invalid URL stored in settings
        return false;
      }

      return hostname === "gitlab.com" || hostname === gitlabHostname;
    }

    default:
      return false;
  }
};

/**
 * Determines the type of mention a URL represents for the given integration,
 * such as an issue, pull request, or project.
 *
 * @param options the URL and integration to evaluate.
 * @returns the mention type, or undefined if the URL is not recognized.
 */
export const determineMentionType = ({
  url,
  integration,
}: {
  url: URL;
  integration: Integration;
}): MentionType | undefined => {
  const provider = getMentionProvider(integration);
  if (provider) {
    return callProvider(
      () => provider.mentionType(url, integration),
      undefined
    );
  }

  const { pathname } = url;
  const pathParts = pathname.split("/");

  switch (integration.service) {
    case IntegrationService.GitHub: {
      const type = pathParts[3];
      return type === "pull"
        ? MentionType.PullRequest
        : type === "issues"
          ? MentionType.Issue
          : type === "projects"
            ? MentionType.Project
            : undefined;
    }

    case IntegrationService.Linear: {
      const type = pathParts[2];
      return type === "issue"
        ? MentionType.Issue
        : type === "project"
          ? MentionType.Project
          : undefined;
    }

    case IntegrationService.GitLab: {
      const hasShowParam = url.searchParams.has("show");

      if (
        /\/-\/merge_requests\/\d+/.test(pathname) ||
        (/\/-\/merge_requests\/?$/.test(pathname) && hasShowParam)
      ) {
        return MentionType.PullRequest;
      }
      if (
        /\/-\/(issues|work_items)\/\d+/.test(pathname) ||
        (/\/-\/(issues|work_items)\/?$/.test(pathname) && hasShowParam)
      ) {
        return MentionType.Issue;
      }
      if (!pathname.includes("/-/")) {
        const parts = pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && !gitlabSystemPaths.has(parts[0])) {
          return MentionType.Project;
        }
      }
      return undefined;
    }

    default:
      return;
  }
};

/**
 * Calls into a plugin's mention provider, treating an error as no match so that
 * a faulty plugin cannot break pasting.
 *
 * @param fn the provider call.
 * @param fallback the value returned when the call throws.
 * @returns the result of the call, or the fallback.
 */
function callProvider<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (_err) {
    return fallback;
  }
}

function parseUrl(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch (_err) {
    return undefined;
  }
}
