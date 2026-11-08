import { omit } from "es-toolkit";
import { m } from "framer-motion";
import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import type { IssueRenderer } from "@shared/editor/types";
import { depths } from "@shared/styles";
import { UnfurlResourceType, type UnfurlResponse } from "@shared/types";
import { Portal } from "~/components/Portal";
import useEventListener from "~/hooks/useEventListener";
import useKeyDown from "~/hooks/useKeyDown";
import useMobile from "~/hooks/useMobile";
import useOnClickOutside from "~/hooks/useOnClickOutside";
import useStores from "~/hooks/useStores";
import Logger from "~/utils/Logger";
import LoadingIndicator from "../LoadingIndicator";
import { CARD_MARGIN } from "./Components";
import HoverPreviewDocument from "./HoverPreviewDocument";
import HoverPreviewGroup from "./HoverPreviewGroup";
import HoverPreviewIssue from "./HoverPreviewIssue";
import HoverPreviewLink from "./HoverPreviewLink";
import HoverPreviewMention from "./HoverPreviewMention";
import HoverPreviewProject from "./HoverPreviewProject";
import HoverPreviewPullRequest from "./HoverPreviewPullRequest";

const DELAY_CLOSE = 500;
const POINTER_HEIGHT = 22;
const POINTER_WIDTH = 22;

type Props = {
  /** The HTML element that is being hovered over, or null if none. */
  element: HTMLElement | null;
  /** ID of the unfurl that will be shown in the hover preview. */
  unfurlId: string | null;
  /** Whether the preview data is being loaded. */
  dataLoading: boolean;
  /** A callback on close of the hover preview. */
  onClose: () => void;
};

enum Direction {
  UP,
  DOWN,
}

const HoverPreviewDesktop = observer(
  ({ element, unfurlId, dataLoading, onClose }: Props) => {
    const { unfurls } = useStores();
    const [isVisible, setVisible] = React.useState(false);
    const timerClose = React.useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined
    );
    const cardRef = React.useRef<HTMLDivElement | null>(null);
    const [card, setCard] = React.useState<HTMLDivElement | null>(null);

    // A plugin's card can mount after the preview opens, once its code has
    // loaded, so the element is kept in state to position it when it appears.
    const handleCardRef = React.useCallback((node: HTMLDivElement | null) => {
      cardRef.current = node;
      setCard(node);
    }, []);
    const { cardLeft, cardTop, pointerLeft, pointerTop, pointerDir } =
      useHoverPosition({
        cardRef,
        cardElement: card,
        element,
        isVisible,
      });
    const data = unfurlId ? unfurls.get(unfurlId)?.data : undefined;
    const renderer = unfurls.getIssueRenderer(unfurlId ?? undefined);

    const closePreview = React.useCallback(() => {
      setVisible(false);
      onClose();
    }, [onClose]);

    const stopCloseTimer = React.useCallback(() => {
      if (timerClose.current) {
        clearTimeout(timerClose.current);
        timerClose.current = undefined;
      }
    }, []);

    const startCloseTimer = React.useCallback(() => {
      timerClose.current = setTimeout(closePreview, DELAY_CLOSE);
    }, [closePreview]);

    // Open and close the preview when the element changes.
    React.useEffect(() => {
      if (element && data && !dataLoading) {
        setVisible(true);
      } else {
        startCloseTimer();
      }
    }, [startCloseTimer, element, data, dataLoading]);

    // Close the preview on Escape, scroll, or click outside.
    useOnClickOutside(cardRef, closePreview);
    useKeyDown("Escape", closePreview);
    useEventListener("scroll", closePreview, window, { capture: true });

    // Ensure that the preview stays open while the user is hovering over the card.
    React.useEffect(() => {
      if (!isVisible || !card) {
        return;
      }

      card.addEventListener("mouseenter", stopCloseTimer);
      card.addEventListener("mouseleave", startCloseTimer);

      return () => {
        card.removeEventListener("mouseenter", stopCloseTimer);
        card.removeEventListener("mouseleave", startCloseTimer);
      };
    }, [card, isVisible, startCloseTimer, stopCloseTimer]);

    // A pending close is dropped when the hovered element changes, and the
    // effect that opens the preview starts a new one when needed. This is
    // separate from the listeners so that a card mounting late keeps it.
    React.useEffect(
      () => stopCloseTimer,
      [element, startCloseTimer, isVisible, stopCloseTimer]
    );

    if (dataLoading) {
      return <LoadingIndicator />;
    }

    if (!data) {
      return null;
    }

    return (
      <Portal toBody>
        <Position top={cardTop} left={cardLeft} aria-hidden>
          {isVisible ? (
            <Animate
              initial={{
                opacity: 0,
                y: -8,
                filter: "blur(5px)",
                pointerEvents: "none",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                transitionEnd: { pointerEvents: "auto" },
              }}
              transition={{
                y: {
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                },
                opacity: {
                  duration: 0.2,
                },
                filter: {
                  duration: 0.2,
                },
              }}
            >
              {data.type === UnfurlResourceType.Mention ? (
                <HoverPreviewMention
                  ref={handleCardRef}
                  name={data.name}
                  avatarUrl={data.avatarUrl}
                  color={data.color}
                  lastActive={data.lastActive}
                  email={data.email}
                />
              ) : data.type === UnfurlResourceType.Group ? (
                <HoverPreviewGroup
                  ref={handleCardRef}
                  name={data.name}
                  description={data.description}
                  memberCount={data.memberCount}
                  users={data.users}
                />
              ) : data.type === UnfurlResourceType.Document ? (
                <HoverPreviewDocument
                  ref={handleCardRef}
                  url={data.url}
                  id={data.id}
                  title={data.title}
                  summary={data.summary}
                  lastActivityByViewer={data.lastActivityByViewer}
                />
              ) : data.type === UnfurlResourceType.Issue ? (
                renderer ? (
                  <PluginIssueHoverPreview
                    ref={handleCardRef}
                    renderer={renderer}
                    data={data}
                  />
                ) : (
                  <HoverPreviewIssue
                    ref={handleCardRef}
                    url={data.url}
                    id={data.id}
                    title={data.title}
                    description={data.description}
                    author={data.author}
                    labels={data.labels}
                    state={data.state}
                    createdAt={data.createdAt}
                  />
                )
              ) : data.type === UnfurlResourceType.PR ? (
                <HoverPreviewPullRequest
                  ref={handleCardRef}
                  url={data.url}
                  id={data.id}
                  title={data.title}
                  description={data.description}
                  author={data.author}
                  createdAt={data.createdAt}
                  state={data.state}
                />
              ) : data.type === UnfurlResourceType.Project ? (
                <HoverPreviewProject
                  ref={handleCardRef}
                  url={data.url}
                  name={data.name}
                  color={data.color}
                  lead={data.lead}
                  labels={data.labels}
                  description={data.description}
                  state={data.state}
                  targetDate={data.targetDate}
                />
              ) : (
                <HoverPreviewLink
                  ref={handleCardRef}
                  url={data.url}
                  thumbnailUrl={data.thumbnailUrl}
                  title={data.title}
                  description={data.description}
                />
              )}
              {card ? (
                <Pointer
                  top={pointerTop}
                  left={pointerLeft}
                  direction={pointerDir}
                />
              ) : null}
            </Animate>
          ) : null}
        </Position>
      </Portal>
    );
  }
);

function HoverPreview({ element, unfurlId, dataLoading, ...rest }: Props) {
  const isMobile = useMobile();
  if (isMobile) {
    return null;
  }

  return (
    <HoverPreviewDesktop
      {...rest}
      element={element}
      unfurlId={unfurlId}
      dataLoading={dataLoading}
    />
  );
}

interface PluginIssueHoverPreviewProps {
  /** The plugin renderer that matched the issue's URL. */
  renderer: IssueRenderer;
  /** The issue unfurl to show. */
  data: UnfurlResponse[UnfurlResourceType.Issue];
  /** Attached to the card so that it can be positioned. */
  ref: React.Ref<HTMLDivElement>;
}

/**
 * Renders an issue hover card with a plugin's component, falling back to the
 * default card if the component fails to load or render.
 */
function PluginIssueHoverPreview({
  renderer,
  data,
  ref,
}: PluginIssueHoverPreviewProps) {
  const issue = omit(data, ["type"]);

  return (
    <PluginBoundary
      key={data.url}
      url={data.url}
      fallback={<HoverPreviewIssue ref={ref} {...issue} />}
    >
      <React.Suspense fallback={null}>
        <renderer.HoverPreview.Component ref={ref} {...issue} />
      </React.Suspense>
    </PluginBoundary>
  );
}

interface PluginBoundaryProps {
  /** The URL of the issue, logged with the error. */
  url: string;
  /** Rendered in place of the children once they have thrown. */
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface PluginBoundaryState {
  hasError: boolean;
}

/** Contains errors from a plugin component, such as a chunk that failed to load. */
class PluginBoundary extends React.Component<
  PluginBoundaryProps,
  PluginBoundaryState
> {
  public static getDerivedStateFromError(): PluginBoundaryState {
    return { hasError: true };
  }

  public state: PluginBoundaryState = { hasError: false };

  public componentDidCatch(error: Error) {
    Logger.error("Failed to render plugin hover preview", error, {
      url: this.props.url,
    });
  }

  public render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function useHoverPosition({
  cardRef,
  cardElement,
  element,
  isVisible,
}: {
  cardRef: React.RefObject<HTMLDivElement | null>;
  /** The mounted card, so that the card is measured again when it changes. */
  cardElement: HTMLDivElement | null;
  element: HTMLElement | null;
  isVisible: boolean;
}) {
  const [cardLeft, setCardLeft] = React.useState(0);
  const [cardTop, setCardTop] = React.useState(0);
  const [pointerLeft, setPointerLeft] = React.useState(0);
  const [pointerTop, setPointerTop] = React.useState(0);
  const [pointerDir, setPointerDir] = React.useState(Direction.UP);

  React.useLayoutEffect(() => {
    if (isVisible && element && cardRef.current) {
      const elem = element.getBoundingClientRect();
      const card = cardRef.current.getBoundingClientRect();

      let cTop = elem.bottom + window.scrollY + CARD_MARGIN;
      let pTop = -POINTER_HEIGHT;
      let pDir = Direction.UP;
      if (cTop + card.height > window.innerHeight + window.scrollY) {
        // shift card upwards if it goes out of screen
        const bottom = elem.top + window.scrollY;
        cTop = bottom - card.height;
        // shift a little further to leave some margin between card and element boundary
        cTop -= CARD_MARGIN;
        // pointer should be shifted downwards to align with card's bottom
        pTop = card.height;
        pDir = Direction.DOWN;
      }
      setCardTop(cTop);
      setPointerTop(pTop);
      setPointerDir(pDir);

      let cLeft = elem.left;
      let pLeft = elem.width / 2;
      if (cLeft + card.width > window.innerWidth) {
        // shift card leftwards by the amount it went out of screen
        let shiftBy = cLeft + card.width - window.innerWidth;
        // shift a little further to leave some margin between card and window boundary
        shiftBy += CARD_MARGIN;
        cLeft -= shiftBy;

        // shift pointer rightwards by same amount so as to position it back correctly
        pLeft += shiftBy;
      }
      setCardLeft(cLeft);
      setPointerLeft(pLeft);
    }
  }, [isVisible, cardRef, cardElement, element]);

  return { cardLeft, cardTop, pointerLeft, pointerTop, pointerDir };
}

const Animate = styled(m.div)`
  @media print {
    display: none;
  }
`;

const Position = styled.div<{ fixed?: boolean; top?: number; left?: number }>`
  position: ${({ fixed }) => (fixed ? "fixed" : "absolute")};
  z-index: ${depths.hoverPreview};
  display: flex;
  max-height: 75%;

  ${({ top }) => (top !== undefined ? `top: ${top}px` : "")};
  ${({ left }) => (left !== undefined ? `left: ${left}px` : "")};
`;

const Pointer = styled.div<{ top: number; left: number; direction: Direction }>`
  top: ${(props) => props.top}px;
  left: ${(props) => props.left}px;
  width: ${POINTER_WIDTH}px;
  height: ${POINTER_HEIGHT}px;
  position: absolute;
  transform: translateX(-50%);
  pointer-events: none;

  &:before,
  &:after {
    content: "";
    display: inline-block;
    position: absolute;
    ${({ direction }) => (direction === Direction.UP ? "bottom: 0" : "top: 0")};
    ${({ direction }) => (direction === Direction.UP ? "right: 0" : "left: 0")};
  }

  &:before {
    border: 8px solid transparent;
    ${({ direction }) =>
      direction === Direction.UP
        ? `border-bottom-color: rgba(0, 0, 0, 0.1)`
        : `border-top-color: rgba(0, 0, 0, 0.1)`};
    ${({ direction }) =>
      direction === Direction.UP ? "right: -1px" : "left: -1px"};
  }

  &:after {
    border: 7px solid transparent;
    ${({ direction, theme }) =>
      direction === Direction.UP
        ? `border-bottom-color: ${theme.menuBackground}`
        : `border-top-color: ${theme.menuBackground}`};
  }
`;

export default HoverPreview;
