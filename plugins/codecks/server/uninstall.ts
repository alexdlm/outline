import { IntegrationService } from "@shared/types";
import type { Integration } from "@server/models";
import { getCodecksAccount } from "./gate";
import { CodecksLimiter } from "./limiter";

/**
 * Cleans up after a Codecks integration is deleted. The team's cached cards
 * are cleared with its unfurls by the integration deletion processor.
 *
 * @param integration the deleted integration, of any service.
 */
export async function uninstall(integration: Integration): Promise<void> {
  if (integration.service !== IntegrationService.Codecks) {
    return;
  }

  const account = getCodecksAccount(integration);
  if (!account) {
    return;
  }

  await CodecksLimiter.clearBackoff(account.id);
}
