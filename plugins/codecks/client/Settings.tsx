import { observer } from "mobx-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { IntegrationService } from "@shared/types";
import { errToString } from "@shared/utils/error";
import { ConnectedButton } from "~/scenes/Settings/components/ConnectedButton";
import { IntegrationScene } from "~/scenes/Settings/components/IntegrationScene";
import SettingRow from "~/scenes/Settings/components/SettingRow";
import { AvatarSize } from "~/components/Avatar";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import List from "~/components/List";
import ListItem from "~/components/List/Item";
import Notice from "~/components/Notice";
import Switch from "~/components/Switch";
import PlaceholderText from "~/components/PlaceholderText";
import Text from "~/components/Text";
import Time from "~/components/Time";
import env from "~/env";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import type {
  CodecksDisplay,
  CodecksInfo,
  CodecksMapping,
  CodecksProject,
} from "../shared/types";
import { CodecksIcon } from "./Icon";
import { ConnectForm } from "./components/ConnectForm";
import { MappingsTable } from "./components/MappingsTable";

/**
 * The Codecks integration settings: connecting an organization with an API
 * token, and mapping its projects to collections.
 */
export const CodecksSettings = observer(function CodecksSettings() {
  const { t } = useTranslation();
  const { integrations } = useStores();
  const appName = env.APP_NAME;
  const [info, setInfo] = React.useState<CodecksInfo | null>();
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [projects, setProjects] = React.useState<CodecksProject[]>();
  const [projectsFailed, setProjectsFailed] = React.useState(false);
  const [replacing, setReplacing] = React.useState(false);

  // Bumped whenever the connection changes, to reload the projects and reset
  // the mappings being edited.
  const [revision, setRevision] = React.useState(0);

  const applyConnection = React.useCallback((next: CodecksInfo | null) => {
    setInfo(next);
    setProjects(undefined);
    setProjectsFailed(false);
    setReplacing(false);
    setRevision((current) => current + 1);
  }, []);

  React.useEffect(() => {
    void integrations.fetchAllIfNeeded({
      service: IntegrationService.Codecks,
      withRelations: true,
    });
  }, [integrations]);

  React.useEffect(() => {
    let cancelled = false;

    client
      .post<{ data: CodecksInfo | null }>("/codecks.info")
      .then((res) => {
        if (!cancelled) {
          applyConnection(res.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadFailed(true);
          toast.error(errToString(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyConnection]);

  const connected = !!info;

  React.useEffect(() => {
    if (!connected) {
      return;
    }

    let cancelled = false;

    client
      .post<{ data: CodecksProject[] }>("/codecks.projects")
      .then((res) => {
        if (!cancelled) {
          setProjects(res.data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectsFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connected, revision]);

  const integration = info ? integrations.get(info.integrationId) : undefined;
  const integrationCreatedBy = integration?.user?.name;

  const handleDisconnect = React.useCallback(async () => {
    if (!info) {
      return;
    }
    if (integration) {
      await integration.delete();
    } else {
      await client.post("/integrations.delete", { id: info.integrationId });
    }
    applyConnection(null);
  }, [info, integration, applyConnection]);

  const handleSaveMappings = React.useCallback(
    async (mappings: CodecksMapping[]) => {
      const res = await client.post<{ data: CodecksInfo }>("/codecks.update", {
        mappings,
      });
      setInfo(res.data);
    },
    []
  );

  const handleDisplayChange = React.useCallback(
    async (display: Partial<CodecksDisplay>) => {
      try {
        const res = await client.post<{ data: CodecksInfo }>(
          "/codecks.update",
          { display }
        );
        setInfo(res.data);

        // Chips read the options from the integration in the store.
        await integrations
          .fetchAll({
            service: IntegrationService.Codecks,
            withRelations: true,
          })
          .catch(() => undefined);
        toast.success(t("Settings saved"));
      } catch (err) {
        toast.error(errToString(err));
      }
    },
    [integrations, t]
  );

  const handleToggleEffort = React.useCallback(
    (effort: boolean) => handleDisplayChange({ effort }),
    [handleDisplayChange]
  );

  const handleToggleAssignee = React.useCallback(
    (assignee: boolean) => handleDisplayChange({ assignee }),
    [handleDisplayChange]
  );

  const handleReplace = React.useCallback(() => setReplacing(true), []);

  const handleCancelReplace = React.useCallback(() => setReplacing(false), []);

  let content: React.ReactNode;
  if (loadFailed) {
    content = (
      <Notice>
        {t(
          "The Codecks settings could not be loaded. Please reload the page to try again."
        )}
      </Notice>
    );
  } else if (info === undefined) {
    content = <PlaceholderText />;
  } else if (info === null) {
    content = <ConnectForm onConnected={applyConnection} />;
  } else {
    const { account } = info;

    content = (
      <>
        <Heading as="h2">{t("Connected")}</Heading>
        <List>
          <ListItem
            small
            title={account.name}
            subtitle={
              <>
                {account.subdomain}.codecks.io
                {integration && integrationCreatedBy ? (
                  <>
                    {" "}
                    &middot;{" "}
                    <Trans>Enabled by {{ integrationCreatedBy }}</Trans>{" "}
                    &middot;{" "}
                    <Time
                      dateTime={integration.createdAt}
                      relative={false}
                      format={{ en_US: "MMMM d, y" }}
                    />
                  </>
                ) : null}
              </>
            }
            image={<CodecksIcon size={AvatarSize.Large} />}
            actions={
              <Flex gap={8}>
                <Button neutral onClick={handleReplace} disabled={replacing}>
                  {t("Replace token")}
                </Button>
                <ConnectedButton
                  onClick={handleDisconnect}
                  confirmationMessage={t(
                    "Disconnecting will stop showing Codecks card details in documents. Card mentions remain as links to Codecks. Are you sure?"
                  )}
                />
              </Flex>
            }
          />
        </List>
        {replacing && (
          <Section>
            <ConnectForm
              defaultSubdomain={account.subdomain}
              onConnected={applyConnection}
              onCancel={handleCancelReplace}
            />
          </Section>
        )}

        <Heading as="h2">{t("Card mentions")}</Heading>
        <Text as="p" type="secondary">
          {t(
            "Choose which optional details card mentions show in documents. Hovering a card always shows all of its details."
          )}
        </Text>
        <SettingRow
          name="codecksEffort"
          label={t("Effort")}
          description={t("Show the effort of a card next to its short id.")}
        >
          <Switch
            id="codecksEffort"
            checked={info.display.effort}
            onChange={handleToggleEffort}
          />
        </SettingRow>
        <SettingRow
          name="codecksAssignee"
          label={t("Assignee")}
          description={t(
            "Show the avatar of the person a card is assigned to."
          )}
          border={false}
        >
          <Switch
            id="codecksAssignee"
            checked={info.display.assignee}
            onChange={handleToggleAssignee}
          />
        </SettingRow>

        <Heading as="h2">{t("Projects")}</Heading>
        <Text as="p" type="secondary">
          <Trans>
            Map Codecks projects to collections. Members only see live card
            details for projects mapped to a collection they can access. Anyone
            else sees a plain link to the card. New cards created from a
            document go into the default deck of its collection.
          </Trans>
        </Text>
        {projectsFailed && (
          <Notice>
            {t(
              "Projects could not be loaded from Codecks. Check that the token is still valid, or replace it."
            )}
          </Notice>
        )}
        <MappingsTable
          key={revision}
          projects={projects}
          mappings={info.mappings}
          onSave={handleSaveMappings}
        />
      </>
    );
  }

  return (
    <IntegrationScene title="Codecks" icon={<CodecksIcon />}>
      <Heading>Codecks</Heading>
      <Text as="p">
        <Trans>
          Show live previews of Codecks cards in documents by connecting a
          Codecks organization to {{ appName }}. Card links are shown with their
          status, priority, assignee and more.
        </Trans>
      </Text>
      {content}
    </IntegrationScene>
  );
});

const Section = styled.div`
  margin: 12px 0 24px;
`;
