import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import { transparentize } from "polished";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { Backticks } from "@shared/components/Backticks";
import type { MenuItem } from "@shared/editor/types";
import {
  MentionType,
  UnfurlResourceType,
  type UnfurlResponse,
} from "@shared/types";
import { stringToColor } from "@shared/utils/color";
import { errToString } from "@shared/utils/error";
import parseDocumentSlug from "@shared/utils/parseDocumentSlug";
import { sanitizeImageSrc } from "@shared/utils/urls";
import { Avatar, AvatarSize } from "~/components/Avatar";
import { useEditor } from "~/editor/components/EditorContext";
import type { Props as SuggestionsMenuProps } from "~/editor/components/SuggestionsMenu";
import SuggestionsMenu from "~/editor/components/SuggestionsMenu";
import SuggestionsMenuItem from "~/editor/components/SuggestionsMenuItem";
import { useLocationSelector } from "~/hooks/useLocationSelector";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import Logger from "~/utils/Logger";
import type { PluginSuggestionMenuProps } from "~/utils/PluginManager";
import { CodecksUtils } from "../../shared/CodecksUtils";
import type { CardSearchResults } from "../search";
import {
  isCurrentSearch,
  isEnterNewLineQuery,
  shouldCloseCardMenu,
  toSearchQuery,
} from "../search";
import { StatusGlyph, getCardStatus, getStatusLabel } from "./StatusGlyph";

type IssueUnfurl = UnfurlResponse[UnfurlResourceType.Issue];

interface CardMenuItem extends MenuItem {
  /** The card that the item mentions, absent for the empty state. */
  card?: IssueUnfurl;
}

/**
 * The menu opened by typing "$". It searches the Codecks cards that the user
 * may see, narrowed to the projects of the document's collection, and mentions
 * the chosen card. A bare "$" lists recently updated cards.
 */
export const CardMenu = observer(function CardMenu_({
  rtl,
  trigger,
  isActive,
  search,
  onClose,
}: PluginSuggestionMenuProps) {
  const { t } = useTranslation();
  const { auth, unfurls } = useStores();
  const editor = useEditor();
  const actorId = auth.currentUserId;
  const documentId = useLocationSelector(
    (location) => parseDocumentSlug(location.pathname) || undefined
  );
  const query = toSearchQuery(search);
  const [results, setResults] = useState<CardSearchResults<IssueUnfurl>>();
  const [wasActive, setWasActive] = useState(isActive);
  const latestRequestRef = useRef(0);

  // The menu always opens on a bare trigger, so only recent cards for the same
  // document are worth showing again while they refresh.
  if (isActive !== wasActive) {
    setWasActive(isActive);
    if (
      isActive &&
      results &&
      !(isCurrentSearch(results, "", documentId) && results.cards.length > 0)
    ) {
      setResults(undefined);
    }
  }

  const closing = shouldCloseCardMenu(search, results, documentId);
  const enterCloses =
    !isCurrentSearch(results, query, documentId) || results.cards.length === 0;

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const request = ++latestRequestRef.current;
    const timeout = setTimeout(
      () =>
        void searchCards(query, documentId).then((cards) => {
          if (request !== latestRequestRef.current) {
            return;
          }

          // The chosen card's mention then renders from the store at once,
          // instead of fetching its unfurl again.
          const fetchedAt = new Date().toISOString();
          runInAction(() => {
            for (const card of cards) {
              unfurls.add({
                id: card.url,
                type: UnfurlResourceType.Issue,
                fetchedAt,
                data: card,
              });
            }
          });
          setResults({ query, documentId, cards });
        }),
      query ? SearchDelay : 0
    );

    return () => clearTimeout(timeout);
  }, [isActive, query, documentId, unfurls]);

  useEffect(() => {
    if (isActive && closing) {
      onClose();
    }
  }, [isActive, closing, onClose]);

  // Until the current query has results, Enter must not choose a card listed
  // for an earlier one, so it closes the menu and starts a new line instead.
  // The editor would otherwise swallow it while the menu is open.
  const keyStateRef = useRef({
    editor,
    isActive,
    loaded: !!results,
    enterCloses,
    onClose,
  });
  useLayoutEffect(() => {
    keyStateRef.current = {
      editor,
      isActive,
      loaded: !!results,
      enterCloses,
      onClose,
    };
  });

  // Registered once, before the menu below mounts. The menu registers its own
  // listener again on every render, so this one always runs first and can stop
  // the menu from also handling the key.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const state = keyStateRef.current;
      if (!state.isActive || event.isComposing || event.defaultPrevented) {
        return;
      }

      // A menu waiting for results stays open when another editor is focused,
      // so keys typed elsewhere are left alone.
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !state.editor.view?.dom.contains(target)
      ) {
        return;
      }

      if (event.key === "Enter" && state.enterCloses) {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.onClose(true);
      } else if (event.key === "Escape" && !state.loaded) {
        event.preventDefault();
        state.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  const items = useMemo((): CardMenuItem[] => {
    if (!results || !actorId) {
      return [];
    }

    if (results.cards.length === 0) {
      return [
        {
          name: "noop",
          title: t("No cards match your search."),
          disabled: true,
        },
      ];
    }

    return results.cards.map((card) => ({
      name: "mention",
      title: card.title || card.id,
      subtitle: card.codecks?.parent?.title,
      icon: (
        <StatusGlyph
          status={getCardStatus(card.codecks, CodecksUtils.isClosed(card))}
          size={16}
        />
      ),
      appendSpace: true,
      card,
      // Built when the item is chosen, so a mention picked from results that
      // are shown again does not reuse the ids of an earlier one. The label is
      // the URL, as nothing about a card is stored in the document.
      attrs: () => ({
        id: uuidv4(),
        type: MentionType.URL,
        modelId: uuidv4(),
        label: card.url,
        href: card.url,
        actorId,
      }),
    }));
  }, [results, actorId, t]);

  const renderMenuItem = useCallback<
    SuggestionsMenuProps<CardMenuItem>["renderMenuItem"]
  >((item, _index, options) => {
    if (!item.card) {
      return <SuggestionsMenuItem {...options} title={item.title} disabled />;
    }

    return (
      <SuggestionsMenuItem
        {...options}
        icon={item.icon}
        title={<CardLabel card={item.card} selected={options.selected} />}
        subtitle={
          item.subtitle ? <ParentTitle>{item.subtitle}</ParentTitle> : undefined
        }
      />
    );
  }, []);

  // Nothing is shown until the first results, as the menu could not be placed
  // correctly without knowing its height. An amount such as "$5" that matches
  // no card is ordinary text, so it gets no empty menu either.
  if (
    !results ||
    closing ||
    (results.cards.length === 0 && /^\d/.test(query))
  ) {
    return null;
  }

  return (
    <SuggestionsMenu
      rtl={rtl}
      trigger={trigger}
      isActive={isActive}
      search={search}
      onClose={onClose}
      filterable={false}
      enterClosesWhenUntouched={isEnterNewLineQuery(query)}
      items={items}
      renderMenuItem={renderMenuItem}
    />
  );
});

interface CardLabelProps {
  /** The card to label. */
  card: IssueUnfurl;
  /** Whether the menu item is selected. */
  selected: boolean;
}

/**
 * The short id, title, status and assignee of a card in the menu. The parts
 * are laid out by the menu item's label, so they are returned as a fragment.
 */
function CardLabel({ card, selected }: CardLabelProps) {
  const { t } = useTranslation();
  const status = getCardStatus(card.codecks, CodecksUtils.isClosed(card));
  const assignee = card.codecks?.assignee;

  return (
    <>
      <ShortId $selected={selected}>{card.id}</ShortId>
      <Title>
        <Backticks content={card.title} />
      </Title>
      <VisuallyHidden.Root>{getStatusLabel(t, status)}</VisuallyHidden.Root>
      {assignee && (
        <Assignee>
          <Avatar
            src={sanitizeImageSrc(assignee.avatarUrl)}
            model={{
              avatarUrl: null,
              name: assignee.name,
              color: stringToColor(assignee.name),
            }}
            alt={t("Assigned to {{ name }}", { name: assignee.name })}
            size={AvatarSize.Small}
          />
        </Assignee>
      )}
    </>
  );
}

/**
 * Searches the cards that the current user may mention.
 *
 * @param query the query, empty for recently updated cards.
 * @param documentId the document being edited, which narrows the search.
 * @returns the cards found, or none if the search failed.
 */
async function searchCards(
  query: string,
  documentId: string | undefined
): Promise<IssueUnfurl[]> {
  try {
    const res = await client.post<{ data: IssueUnfurl[] }>("/codecks.search", {
      query,
      documentId,
    });
    return res.data.filter((card) => CodecksUtils.isCardUrl(card.url));
  } catch (err) {
    Logger.warn("Failed to search Codecks cards", {
      message: errToString(err),
    });
    return [];
  }
}

/** How long typing must pause before searching, in milliseconds. */
const SearchDelay = 150;

const ShortId = styled.span<{ $selected: boolean }>`
  flex-shrink: 0;
  font-family: ${(props) => props.theme.fontFamilyMono};
  font-size: 0.85em;
  color: ${(props) =>
    props.$selected
      ? transparentize(0.35, props.theme.accentText)
      : props.theme.textTertiary};
`;

const Title = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ParentTitle = styled.span`
  display: inline-block;
  max-width: 14em;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
`;

// The label lays out the title before the subtitle, so the avatar is moved to
// the end of the row with the flex order.
const Assignee = styled.span`
  order: 1;
  flex-shrink: 0;
  display: flex;
  margin-inline-start: auto;
  padding-inline-start: 8px;
`;
