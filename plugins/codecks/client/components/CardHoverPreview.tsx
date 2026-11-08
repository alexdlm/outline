import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { Backticks } from "@shared/components/Backticks";
import { richExtensions } from "@shared/editor/nodes";
import type { IssueHoverPreviewProps } from "@shared/editor/types";
import { UnfurlResourceType } from "@shared/types";
import { stringToColor } from "@shared/utils/color";
import { sanitizeImageSrc } from "@shared/utils/urls";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Editor from "~/components/Editor";
import Flex from "~/components/Flex";
import {
  BreadcrumbContainer,
  Card,
  CardContent,
  Description,
  Info,
  Label,
  Preview,
  Title,
} from "~/components/HoverPreview/Components";
import Text from "~/components/Text";
import Time from "~/components/Time";
import { CodecksUtils } from "../../shared/CodecksUtils";
import { DeckSwatch, getDeckColor } from "./DeckSwatch";
import { getPriorityColor, getPriorityLabel } from "./priority";
import {
  StatusGlyph,
  getCardStatus,
  getStatusColor,
  getStatusLabel,
} from "./StatusGlyph";

/**
 * The hover card for a Codecks card mention, with the card's project, deck,
 * status, priority, effort, assignee, parent card and description.
 *
 * @param props the card unfurl and a ref for the card element.
 * @returns the hover card element.
 */
export function CardHoverPreview({ ref, ...unfurl }: IssueHoverPreviewProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { url, id, title, description, createdAt, codecks: details } = unfurl;
  const status = getCardStatus(
    details,
    CodecksUtils.isClosed({ ...unfurl, type: UnfurlResourceType.Issue })
  );
  const project = details?.project ?? null;
  const deck = details?.deck ?? null;
  const parent = details?.parent ?? null;
  const assignee = details?.assignee ?? null;
  const milestone = details?.milestone ?? null;
  const childCount = details?.childCount ?? 0;
  const lastUpdatedAt = details?.lastUpdatedAt ?? null;
  const deckColor = getDeckColor(deck?.coverColor);
  const assigneeName = assignee?.name;
  const parentTitle = parent?.title;
  const parentId = parent ? `$${parent.shortId}` : undefined;

  return (
    <Preview as="a" href={url} target="_blank" rel="noopener noreferrer">
      <Flex column ref={ref}>
        <Card fadeOut={false}>
          <CardContent>
            <Flex gap={2} column>
              {(project || deck) && (
                <Breadcrumb>
                  {deck && <DeckSwatch color={deck.coverColor} size={10} />}
                  {project && <span>{project.name}</span>}
                  {deck && <span>{deck.title}</span>}
                </Breadcrumb>
              )}
              <Title>
                <StyledStatusGlyph status={status} size={18} />
                <span>
                  <Backticks content={title} />
                  &nbsp;<Text type="tertiary">{id}</Text>
                </span>
              </Title>

              <Labels wrap gap={6} align="center">
                <Label color={getStatusColor(status, theme)}>
                  {getStatusLabel(t, status)}
                </Label>
                {details?.priority && (
                  <Label color={getPriorityColor(details.priority, theme)}>
                    {getPriorityLabel(t, details.priority)}
                  </Label>
                )}
                {details?.effort !== null && details?.effort !== undefined && (
                  <Label>
                    {t("Effort {{ effort }}", { effort: details.effort })}
                  </Label>
                )}
                {childCount > 0 && (
                  <Label color={theme.yellow}>
                    {t("{{ count }} sub card", { count: childCount })}
                  </Label>
                )}
                {milestone && (
                  <Label color={getMilestoneColor(milestone.color, theme)}>
                    {milestone.name}
                  </Label>
                )}
              </Labels>

              <Meta column gap={4}>
                {assignee && (
                  <Flex align="center" gap={6}>
                    <Avatar
                      src={sanitizeImageSrc(assignee.avatarUrl)}
                      model={{
                        avatarUrl: null,
                        name: assignee.name,
                        color: stringToColor(assignee.name),
                      }}
                      alt=""
                      size={AvatarSize.Toast}
                      showHoverCard={false}
                    />
                    <Info>
                      <Trans>Assigned to {{ assigneeName }}</Trans>
                    </Info>
                  </Flex>
                )}
                {parent && (
                  <TruncatedInfo>
                    <Trans>
                      Sub card of {{ parentTitle }} {{ parentId }}
                    </Trans>
                  </TruncatedInfo>
                )}
                {lastUpdatedAt ? (
                  <Info>
                    <Trans>
                      Updated <Time dateTime={lastUpdatedAt} addSuffix />
                    </Trans>
                  </Info>
                ) : createdAt ? (
                  <Info>
                    <Trans>
                      Created <Time dateTime={createdAt} addSuffix />
                    </Trans>
                  </Info>
                ) : null}
              </Meta>

              {description && (
                <Description as="div">
                  <React.Suspense fallback={<div />}>
                    <Editor
                      extensions={richExtensions}
                      defaultValue={description}
                      embedsDisabled
                      readOnly
                    />
                  </React.Suspense>
                </Description>
              )}
            </Flex>
          </CardContent>
        </Card>
        {deckColor && <DeckStripe $color={deckColor} />}
      </Flex>
    </Preview>
  );
}

// Codecks names a fixed set of milestone colors rather than giving hex values.
function getMilestoneColor(color: string | null, theme: DefaultTheme) {
  switch (color) {
    case "red":
      return theme.brand.red;
    case "pink":
      return theme.brand.pink;
    case "yellow":
      return theme.brand.yellow;
    case "green":
      return theme.brand.green;
    case "blue":
      return theme.brand.marine;
    case "brown":
      return "#a1785c";
    default:
      return theme.textTertiary;
  }
}

const Breadcrumb = styled(BreadcrumbContainer)`
  gap: 6px;

  span:not(:last-child)::after {
    content: "›";
    margin: 0 0 0 6px;
  }
`;

const StyledStatusGlyph = styled(StatusGlyph)`
  flex-shrink: 0;
  margin-top: 2px;
`;

const Labels = styled(Flex)`
  margin-top: 4px;
`;

const Meta = styled(Flex)`
  margin-top: 8px;
`;

const TruncatedInfo = styled(Info)`
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DeckStripe = styled.div<{ $color: string }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: ${(props) => props.$color};
`;
