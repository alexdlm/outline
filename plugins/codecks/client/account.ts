import { IntegrationService } from "@shared/types";
import type Integration from "~/models/Integration";
import { CodecksUtils } from "../shared/CodecksUtils";
import type { CodecksAccount } from "../shared/types";

/**
 * The Codecks organization connected through an integration. Only team
 * members are presented the organization, so guests never get one.
 *
 * @param integration the integration to read.
 * @returns the organization, or undefined if the integration is not a
 * connected Codecks integration.
 */
export function getCodecksAccount(
  integration: Integration
): CodecksAccount | undefined {
  if (integration.service !== IntegrationService.Codecks) {
    return undefined;
  }

  // The settings are typed by the model's type parameter, which is unknown
  // here, so the value is checked instead.
  const settings: unknown = integration.settings;
  if (!isObject(settings) || !("codecks" in settings)) {
    return undefined;
  }

  const codecks: unknown = settings.codecks;
  if (!isObject(codecks) || !("account" in codecks)) {
    return undefined;
  }

  const account: unknown = codecks.account;
  if (
    !isObject(account) ||
    !("id" in account) ||
    !("name" in account) ||
    !("subdomain" in account)
  ) {
    return undefined;
  }

  const { id, name, subdomain } = account;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof subdomain !== "string" ||
    !subdomain
  ) {
    return undefined;
  }

  return { id, name, subdomain };
}

/**
 * Whether a URL is a card of the organization connected through an
 * integration.
 *
 * @param url the URL to check.
 * @param integration the integration whose organization the card must belong to.
 * @returns true if the URL is a card of the connected organization.
 */
export function isConnectedCardUrl(
  url: URL,
  integration: Integration
): boolean {
  const account = getCodecksAccount(integration);
  if (!account) {
    return false;
  }

  return CodecksUtils.isCardUrl(url, account.subdomain.toLowerCase());
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
