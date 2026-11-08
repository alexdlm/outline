import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { IntegrationService } from "@shared/types";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { CodecksUtils } from "../../shared/CodecksUtils";
import type { CodecksInfo } from "../../shared/types";

interface Props {
  /** The subdomain to prefill, when replacing the token of a connection. */
  defaultSubdomain?: string;
  /** Called once the organization is connected. */
  onConnected: (info: CodecksInfo) => void;
  /** Called when the form is dismissed, a cancel button is shown if set. */
  onCancel?: () => void;
}

/**
 * A form that connects a Codecks organization with an API token, or replaces
 * the token of the connected organization.
 */
export function ConnectForm({
  defaultSubdomain,
  onConnected,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const { integrations } = useStores();
  const [organizationUrl, setOrganizationUrl] = React.useState(
    defaultSubdomain ? `https://${defaultSubdomain}.codecks.io` : ""
  );
  const [token, setToken] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const subdomain = parseSubdomain(organizationUrl);

  const handleOrganizationUrlChange = (
    ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setOrganizationUrl(ev.currentTarget.value);

  const handleTokenChange = (
    ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setToken(ev.currentTarget.value);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const trimmedToken = token.trim();
    if (!subdomain || !trimmedToken) {
      return;
    }

    setSaving(true);
    try {
      const res = await client.post<{ data: CodecksInfo }>("/codecks.connect", {
        apiToken: trimmedToken,
        subdomain,
      });
      setToken("");

      // The integration exists at this point, so a failure to refresh the
      // list only affects the "Enabled by" details shown.
      await integrations
        .fetchAll({ service: IntegrationService.Codecks, withRelations: true })
        .catch(() => undefined);

      toast.success(t("Codecks connected"));
      onConnected(res.data);
    } catch (err) {
      toast.error(errToString(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Flex column gap={12}>
        <Text as="p" type="secondary">
          <Trans>
            Create a token in Codecks under Organization Settings › Integrations
            › API Tokens. A Read token is enough for card previews. Creating
            cards from documents will need a Read & write token.
          </Trans>
        </Text>
        <Input
          label={t("Organization URL")}
          placeholder="https://acme.codecks.io"
          value={organizationUrl}
          onChange={handleOrganizationUrlChange}
          error={
            organizationUrl.trim() && !subdomain
              ? t(
                  "Enter the address of your organization, such as https://acme.codecks.io."
                )
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          required
          autoFocus={!defaultSubdomain}
        />
        <Input
          label={t("API token")}
          type="password"
          placeholder="cdxat_…"
          value={token}
          onChange={handleTokenChange}
          autoComplete="off"
          spellCheck={false}
          required
          autoFocus={!!defaultSubdomain}
        />
        <Actions justify="flex-end" gap={8}>
          {onCancel && (
            <Button neutral onClick={onCancel} disabled={saving}>
              {t("Cancel")}
            </Button>
          )}
          <Button
            type="submit"
            disabled={!subdomain || !token.trim() || saving}
          >
            {saving ? `${t("Connecting")}…` : t("Connect")}
          </Button>
        </Actions>
      </Flex>
    </form>
  );
}

const SubdomainPattern = /^[a-z0-9-]{1,63}$/;
const CodecksHost = ".codecks.io";

/**
 * Derives the organization subdomain from what an admin typed, which may be a
 * bare subdomain, a host name or a URL of any page in the organization.
 *
 * @param value the entered text.
 * @returns the subdomain, or undefined if it cannot be derived.
 */
function parseSubdomain(value: string): string | undefined {
  const input = value.trim().toLowerCase();
  let subdomain: string | undefined;

  if (SubdomainPattern.test(input)) {
    subdomain = input;
  } else {
    try {
      const { hostname } = new URL(
        input.includes("://") ? input : `https://${input}`
      );
      subdomain = hostname.endsWith(CodecksHost)
        ? hostname.slice(0, -CodecksHost.length)
        : undefined;
    } catch {
      return undefined;
    }
  }

  // Only accept organizations whose card links the plugin recognizes.
  return subdomain &&
    CodecksUtils.isCardUrl(CodecksUtils.buildCardUrl(subdomain, "111"))
    ? subdomain
    : undefined;
}

const Actions = styled(Flex)`
  margin-top: 4px;
`;
