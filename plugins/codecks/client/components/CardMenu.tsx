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
import { UrlHelper } from "@shared/utils/UrlHelper";
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
  answerQuery,
  findsNothing,
  shouldCloseCardMenu,
  toSearchQuery,
} from "../search";
import { getDeckColor } from "./DeckSwatch";
import { StatusGlyph, getCardStatus, getStatusLabel } from "./StatusGlyph";

type IssueUnfurl = UnfurlResponse[UnfurlResourceType.Issue];

interface CardMenuItem extends MenuItem {
  /** The card that the item mentions, absent for the empty state. */
  card?: IssueUnfurl;
}

/**
 * The menu opened by typing "$". It searches the Codecks cards that the user
 * may see, narrowed to the projects of the document's collection, and mentions
 * the chosen card. A bare "$" lists recently updated cards. Earlier results
 * narrow the list as the user types, and searches are only made for what they
 * cannot answer.
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
  // The id at the end of the slug, which unlike the slug stays the same when
  // the document is renamed.
  const documentId = useLocationSelector(
    (location) =>
      parseDocumentSlug(location.pathname)?.match(
        UrlHelper.SLUG_URL_REGEX
      )?.[1] || undefined
  );
  const query = toSearchQuery(search);
  const [results, setResults] = useState(() => resultCache.list());
  const [revealed, setRevealed] = useState(false);
  const [wasActive, setWasActive] = useState(isActive);

  // Other menus may have searched since this one was last open.
  if (isActive !== wasActive) {
    setWasActive(isActive);
    setRevealed(false);
    if (isActive) {
      setResults(resultCache.list());
    }
  }

  const answer = useMemo(
    () => answerQuery(results, query, documentId, Date.now()),
    [results, query, documentId]
  );
  const searching = !answer.complete && !answer.failed;
  const closing = shouldCloseCardMenu(search, answer);

  // A menu with nothing to show yet waits briefly before showing that it is
  // searching, so that a quick answer does not flash a loading state.
  useEffect(() => {
    if (!isActive || revealed) {
      return;
    }
    const timeout = setTimeout(() => setRevealed(true), RevealDelay);
    return () => clearTimeout(timeout);
  }, [isActive, revealed]);

  useEffect(() => {
    if (!isActive || !searching) {
      return;
    }

    const timeout = setTimeout(
      () => {
        if (!resultCache.start(query, documentId)) {
          return;
        }

        void searchCards(query, documentId).then((cards) => {
          const receivedAt = Date.now();
          resultCache.finish({
            query,
            documentId,
            cards: cards ?? [],
            failed: !cards,
            receivedAt,
          });

          // The chosen card's mention then renders from the store at once,
          // instead of fetching its unfurl again.
          if (cards) {
            const fetchedAt = new Date(receivedAt).toISOString();
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
          }
          setResults(resultCache.list());
        });
      },
      query ? SearchDelay : 0
    );

    return () => clearTimeout(timeout);
  }, [isActive, searching, query, documentId, unfurls]);

  useEffect(() => {
    if (isActive && closing) {
      onClose();
    }
  }, [isActive, closing, onClose]);

  const hidden =
    closing ||
    findsNothing(query) ||
    (answer.cards.length === 0 && searching && !revealed);

  // While no card is listed, Enter closes the menu and starts a new line, and
  // Escape closes a menu that is not shown. The editor would otherwise swallow
  // them while the menu is open.
  const keyStateRef = useRef({
    editor,
    isActive,
    hidden,
    enterCloses: answer.cards.length === 0,
    onClose,
  });
  useLayoutEffect(() => {
    keyStateRef.current = {
      editor,
      isActive,
      hidden,
      enterCloses: answer.cards.length === 0,
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
      } else if (event.key === "Escape" && state.hidden) {
        event.preventDefault();
        state.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  const status = answer.failed
    ? t("Codecks could not be searched, try again shortly.")
    : searching
      ? t("Searching…")
      : answer.cards.length === 0
        ? t("No cards match your search.")
        : undefined;

  const items = useMemo((): CardMenuItem[] => {
    if (!actorId) {
      return [];
    }

    const cardItems = answer.cards.map((card): CardMenuItem => ({
      name: "mention",
      title: card.title || card.id,
      icon: (
        <StatusGlyph
          status={getCardStatus(card.codecks, CodecksUtils.isClosed(card))}
          size={16}
        />
      ),
      appendSpace: true,
      card,
      // Built when the item is chosen, so a mention picked from results that
      // are shown again does not reuse the ids of an earlier one. The label
      // is the URL, as nothing about a card is stored in the document.
      attrs: () => ({
        id: uuidv4(),
        type: MentionType.URL,
        modelId: uuidv4(),
        label: card.url,
        href: card.url,
        actorId,
      }),
    }));

    return status
      ? [...cardItems, { name: "noop", title: status, disabled: true }]
      : cardItems;
  }, [answer.cards, status, actorId]);

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
      />
    );
  }, []);

  if (hidden) {
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
      width={MenuWidth}
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
  const parent = card.codecks?.parent;
  const deck = card.codecks?.deck;
  const childCount = card.codecks?.childCount ?? 0;
  const deckColor = getDeckColor(deck?.coverColor, deck?.title);

  return (
    <>
      <Lines>
        <Heading>
          <ShortId $selected={selected}>{card.id}</ShortId>
          <Title>
            <Backticks content={card.title || card.id} />
          </Title>
          <VisuallyHidden.Root>{getStatusLabel(t, status)}</VisuallyHidden.Root>
        </Heading>
        {(parent || deck || childCount > 0) && (
          <Details>
            {parent && (
              <Pill $selected={selected}>
                <PillText>
                  <Backticks content={parent.title} />
                </PillText>
              </Pill>
            )}
            {!parent && childCount > 0 && (
              <Pill $selected={selected}>
                <PillText>
                  {t("Sub cards: {{ count }}", { count: childCount })}
                </PillText>
              </Pill>
            )}
            {deck && (
              <Pill $selected={selected} $color={deckColor}>
                <PillText>{deck.title}</PillText>
              </Pill>
            )}
          </Details>
        )}
      </Lines>
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
 * @returns the cards found, or undefined if the search failed.
 */
async function searchCards(
  query: string,
  documentId: string | undefined
): Promise<IssueUnfurl[] | undefined> {
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
    return undefined;
  }
}

/**
 * Results of earlier searches, shared by every card menu so that reopening the
 * menu or typing a query again does not search again while they are fresh.
 */
class ResultCache {
  /**
   * The results kept, newest last.
   *
   * @returns the results.
   */
  public list(): CardSearchResults<IssueUnfurl>[] {
    return [...this.results.values()];
  }

  /**
   * Marks a search as started, unless the same one already is.
   *
   * @param query the query.
   * @param documentId the document that narrows the search, if any.
   * @returns true if the search should be made.
   */
  public start(query: string, documentId: string | undefined): boolean {
    const key = ResultCache.key(query, documentId);
    if (this.pending.has(key)) {
      return false;
    }
    this.pending.add(key);
    return true;
  }

  /**
   * Keeps the results of a finished search, dropping the oldest results once
   * too many are kept.
   *
   * @param results the results.
   */
  public finish(results: CardSearchResults<IssueUnfurl>): void {
    const key = ResultCache.key(results.query, results.documentId);
    this.pending.delete(key);
    this.results.delete(key);
    this.results.set(key, results);

    while (this.results.size > MaxCachedResults) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.results.delete(oldest);
    }
  }

  private results = new Map<string, CardSearchResults<IssueUnfurl>>();

  private pending = new Set<string>();

  private static key(query: string, documentId: string | undefined) {
    return `${documentId ?? ""}\n${query}`;
  }
}

const resultCache = new ResultCache();

/** The most results kept for reuse. */
const MaxCachedResults = 50;

/** How long a menu with nothing to show waits to show it is searching, in milliseconds. */
const RevealDelay = 150;

/** How long typing must pause before searching, in milliseconds. */
const SearchDelay = 250;

/** The width of the menu in pixels, wider than other menus to fit card titles. */
const MenuWidth = 400;

// The short id and title lead each row, the parent and deck follow as pills.
// The alignment is set because menu rows are buttons, which center text.
const Lines = styled.span`
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 auto;
  min-width: 0;
  text-align: start;
  padding: 3px 0;
  line-height: 1.3;
`;

const Heading = styled.span`
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
`;

const ShortId = styled.span<{ $selected: boolean }>`
  flex-shrink: 0;
  font-family: ${(props) => props.theme.fontFamilyMono};
  font-size: 13px;
  color: ${(props) =>
    props.$selected
      ? transparentize(0.25, props.theme.accentText)
      : props.theme.textSecondary};
`;

const Title = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
`;

const PillText = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Details = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

// A pill with a color is a deck, marked by a dot in the deck's color.
const Pill = styled.span<{ $selected: boolean; $color?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 60%;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  color: ${(props) =>
    props.$selected ? props.theme.accentText : props.theme.textSecondary};
  background: ${(props) =>
    props.$selected
      ? transparentize(0.8, props.theme.accentText)
      : props.$color
        ? transparentize(0.85, props.$color)
        : transparentize(0.88, props.theme.textTertiary)};

  ${(props) =>
    props.$color
      ? `&::before {
          content: "";
          flex-shrink: 0;
          width: 7px;
          height: 7px;
          border-radius: 2px;
          background: ${props.$color};
        }`
      : ""}
`;

const Assignee = styled.span`
  flex-shrink: 0;
  display: flex;
  padding-inline-start: 8px;
`;
