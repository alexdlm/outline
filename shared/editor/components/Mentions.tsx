import { observer } from "mobx-react";
import {
  DocumentIcon,
  EmailIcon,
  CollectionIcon,
  WarningIcon,
} from "outline-icons";
import type { Node } from "prosemirror-model";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import {
  dateToRelativeReadable,
  hasTimeComponent,
  parseISODate,
} from "../../utils/date";
import { Backticks } from "../../components/Backticks";
import Flex from "../../components/Flex";
import Icon from "../../components/Icon";
import { IssueStatusIcon } from "../../components/IssueStatusIcon";
import { PullRequestIcon } from "../../components/PullRequestIcon";
import Spinner from "../../components/Spinner";
import Text from "../../components/Text";
import useStores from "../../hooks/useStores";
import useShare from "../../hooks/useShare";
import env from "../../env";
import theme from "../../styles/theme";
import {
  IntegrationService,
  UnfurlResourceType,
  type JSONValue,
  type UnfurlResponse,
} from "../../types";
import { toPersistedUnfurl } from "../lib/mention";
import { cn } from "../styles/utils";
import type {
  ComponentProps,
  IssueMentionProps,
  IssueRenderer,
} from "../types";
import lazyWithRetry from "../../utils/lazyWithRetry";
import { sharedModelPath } from "../../utils/routeHelpers";
import { toDisplayUrl, cdnPath, sanitizeImageSrc } from "../../utils/urls";
import Squircle from "../../components/Squircle";

type Attrs = {
  className: string;
  unfurl?: UnfurlResponse[keyof UnfurlResponse];
} & Record<string, JSONValue>;

const getAttributesFromNode = (node: Node): Attrs => {
  const spec = node.type.spec.toDOM?.(node) as unknown as Record<
    string,
    JSONValue
  >[];
  const { class: className, "data-unfurl": unfurl, ...attrs } = spec[1];

  return {
    className: className as Attrs["className"],
    unfurl: unfurl
      ? (JSON.parse(unfurl as string) as Attrs["unfurl"])
      : undefined,
    ...attrs,
  };
};

/**
 * Returns a hook that scopes an internal model path to the current public share,
 * if any, so that navigation stays within the share rather than falling through
 * to the authenticated app (and its login screen).
 */
const useSharePath = () => {
  const { shareId } = useShare();

  return React.useCallback(
    (path: string) =>
      shareId ? sharedModelPath(shareId, path, env.ROOT_SHARE_ID) : path,
    [shareId]
  );
};

export const MentionUser = observer(function MentionUser_(
  props: ComponentProps
) {
  const { isSelected, node } = props;
  const { users } = useStores();
  const user = users.get(node.attrs.modelId);
  const { className, unfurl, ...attrs } = getAttributesFromNode(node);

  return (
    <span
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
    >
      <EmailIcon size={18} />
      <span>{user?.name || node.attrs.label}</span>
    </span>
  );
});

export const MentionGroup = observer(function MentionGroup_(
  props: ComponentProps
) {
  const { isSelected, node } = props;
  const { groups } = useStores();
  const group = groups.get(node.attrs.modelId);
  const { className, ...attrs } = getAttributesFromNode(node);

  return (
    <span
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
    >
      <EmailIcon size={18} />
      <span>{group?.name || node.attrs.label}</span>
    </span>
  );
});

export const MentionDocument = observer(function MentionDocument_(
  props: ComponentProps
) {
  const { isSelected, node } = props;
  const { documents } = useStores();
  const doc = documents.get(node.attrs.modelId);
  const modelId = node.attrs.modelId;
  const anchorId = node.attrs.anchorId;
  const { className, unfurl, ...attrs } = getAttributesFromNode(node);
  const sharePath = useSharePath();

  React.useEffect(() => {
    if (modelId) {
      void documents.prefetchDocument(modelId);
    }
  }, [modelId, documents]);

  const documentPath = sharePath(doc?.path ?? `/doc/${node.attrs.modelId}`);

  return (
    <Link
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
      to={anchorId ? `${documentPath}#${anchorId}` : documentPath}
    >
      {doc?.icon ? (
        <Icon
          value={doc.icon}
          initial={doc.initial}
          color={doc.color}
          size={18}
        />
      ) : (
        <DocumentIcon size={18} />
      )}
      <span>{doc?.title || node.attrs.label}</span>
    </Link>
  );
});

export const MentionCollection = observer(function MentionCollection_(
  props: ComponentProps
) {
  const { isSelected, node } = props;
  const { collections } = useStores();
  const collection = collections.get(node.attrs.modelId);
  const modelId = node.attrs.modelId;
  const { className, unfurl, ...attrs } = getAttributesFromNode(node);
  const sharePath = useSharePath();

  React.useEffect(() => {
    if (modelId) {
      void collections.fetch(modelId);
    }
  }, [modelId, collections]);

  return (
    <Link
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
      to={sharePath(collection?.path ?? `/collection/${node.attrs.modelId}`)}
    >
      {collection?.icon ? (
        <Icon
          value={collection.icon}
          initial={collection.initial}
          color={collection.color}
          size={18}
        />
      ) : (
        <CollectionIcon size={18} />
      )}
      <span>{collection?.title || node.attrs.label}</span>
    </Link>
  );
});

type IssuePrProps = ComponentProps & {
  onChangeUnfurl: (unfurl: UnfurlResponse[keyof UnfurlResponse]) => void;
};

type IssueUrlProps = ComponentProps & {
  onChangeUnfurl: (unfurl: UnfurlResponse[keyof UnfurlResponse]) => void;
};

export const MentionURL = observer((props: IssueUrlProps) => {
  const { unfurls } = useStores();
  const [loaded, setLoaded] = React.useState(false);
  const onChangeUnfurl = React.useRef(props.onChangeUnfurl).current; // stable reference to callback function.

  const { isSelected, node } = props;
  const {
    className,
    unfurl: unfurlAttr,
    ...attrs
  } = getAttributesFromNode(node);

  const url = typeof attrs.href === "string" ? attrs.href : undefined;
  const renderer: IssueRenderer | undefined = unfurls.getIssueRenderer(url);
  const unfurl = url ? (unfurls.get(url)?.data ?? unfurlAttr) : undefined;

  React.useEffect(() => {
    if (!url) {
      setLoaded(true);
      return;
    }

    // The node view may be destroyed before the fetch resolves, in which case
    // the editor transaction in onChangeUnfurl must not be dispatched.
    let cancelled = false;

    const fetchUnfurl = async () => {
      try {
        const unfurlModel = await unfurls.fetchUnfurl({ url });

        if (cancelled) {
          return;
        }

        // We got a result back from the server, so update the unfurl in the node attributes.
        if (unfurlModel) {
          const persisted = toPersistedUnfurl(unfurlModel.data, renderer);
          if (persisted) {
            onChangeUnfurl(persisted);
          }
          return;
        }

        // A plugin renders its links without an unfurl. A placeholder would be
        // cached under the URL and shown as a generic link on hover.
        if (renderer) {
          return;
        }

        const attrs = getAttributesFromNode(node);
        // If we have a unfurl attribute, use that.
        // Otherwise, set a basic unfurl to avoid refetching again in future.
        // This will just show the URL with a generic link icon.
        const data = attrs.unfurl
          ? attrs.unfurl
          : {
              title: toDisplayUrl(url),
              faviconUrl: cdnPath("/images/link.png"),
            };
        unfurls.add({
          id: url,
          type: UnfurlResourceType.URL,
          fetchedAt: new Date().toISOString(),
          data,
        });
      } finally {
        setLoaded(true);
      }
    };

    void fetchUnfurl();

    return () => {
      cancelled = true;
    };
  }, [unfurls, url, node, onChangeUnfurl, renderer]);

  if (renderer && url) {
    const live: UnfurlResponse[keyof UnfurlResponse] | undefined =
      unfurls.get(url)?.data;

    return (
      <PluginIssueMention
        renderer={renderer}
        attrs={attrs}
        className={cn(className, {
          "ProseMirror-selectednode": isSelected,
        })}
        href={url}
        label={node.attrs.label}
        unfurl={live?.type === UnfurlResourceType.Issue ? live : undefined}
        storedUnfurl={unfurlAttr}
        loaded={loaded}
      />
    );
  }

  if (!unfurl) {
    return !loaded ? (
      <MentionLoading className={className} />
    ) : (
      <MentionError className={className} />
    );
  }

  return (
    <a
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      <Flex align="center" gap={6}>
        {unfurl.faviconUrl ? (
          <Logo src={sanitizeImageSrc(unfurl.faviconUrl)} alt="" />
        ) : null}
        <Text>
          <Backticks content={unfurl.title} />
        </Text>
      </Flex>
    </a>
  );
});

export const MentionIssue = observer((props: IssuePrProps) => {
  const { unfurls } = useStores();
  const [loaded, setLoaded] = React.useState(false);
  const onChangeUnfurl = React.useRef(props.onChangeUnfurl).current; // stable reference to callback function.

  const { isSelected, node } = props;
  const {
    className,
    unfurl: unfurlAttr,
    ...attrs
  } = getAttributesFromNode(node);

  const href = typeof attrs.href === "string" ? attrs.href : undefined;
  const renderer: IssueRenderer | undefined = unfurls.getIssueRenderer(href);
  const unfurl = unfurls.get(attrs.href)?.data ?? unfurlAttr;

  React.useEffect(() => {
    // The node view may be destroyed before the fetch resolves, in which case
    // the editor transaction in onChangeUnfurl must not be dispatched.
    let cancelled = false;

    const fetchIssue = async () => {
      const unfurlModel = await unfurls.fetchUnfurl({ url: attrs.href });

      if (cancelled) {
        return;
      }

      if (unfurlModel) {
        const persisted = toPersistedUnfurl(unfurlModel.data, renderer);
        if (persisted) {
          onChangeUnfurl(persisted);
        }
      }

      setLoaded(true);
    };

    void fetchIssue();

    return () => {
      cancelled = true;
    };
  }, [unfurls, attrs.href, onChangeUnfurl, renderer]);

  if (renderer && href) {
    const live: UnfurlResponse[keyof UnfurlResponse] | undefined =
      unfurls.get(href)?.data;

    return (
      <PluginIssueMention
        renderer={renderer}
        attrs={attrs}
        className={cn(className, {
          "ProseMirror-selectednode": isSelected,
        })}
        href={href}
        label={node.attrs.label}
        unfurl={live?.type === UnfurlResourceType.Issue ? live : undefined}
        storedUnfurl={unfurlAttr}
        loaded={loaded}
      />
    );
  }

  if (!unfurl) {
    return !loaded ? (
      <MentionLoading className={className} />
    ) : (
      <MentionError className={className} />
    );
  }

  const issue = unfurl as UnfurlResponse[UnfurlResourceType.Issue];

  let service = IntegrationService.GitLab;
  try {
    const parsedUrl = new URL(issue.url);
    service =
      parsedUrl.hostname === "github.com"
        ? IntegrationService.GitHub
        : parsedUrl.hostname === "linear.app"
          ? IntegrationService.Linear
          : IntegrationService.GitLab;
  } catch {
    // Invalid URL in unfurl data, default to GitLab
  }

  return (
    <a
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
      href={attrs.href as string}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      <Flex align="center" gap={6}>
        <IssueStatusIcon size={14} service={service} state={issue.state} />
        <Flex align="center" gap={4}>
          <Text>
            <Backticks content={issue.title} />
          </Text>
          <Text type="tertiary">{issue.id}</Text>
        </Flex>
      </Flex>
    </a>
  );
});

type ProjectProps = ComponentProps & {
  onChangeUnfurl: (unfurl: UnfurlResponse[UnfurlResourceType.Project]) => void;
};

export const MentionProject = observer((props: ProjectProps) => {
  const { unfurls } = useStores();
  const [loaded, setLoaded] = React.useState(false);
  const onChangeUnfurl = React.useRef(props.onChangeUnfurl).current;

  const { isSelected, node } = props;
  const {
    className,
    unfurl: unfurlAttr,
    ...attrs
  } = getAttributesFromNode(node);

  const unfurl = unfurls.get(attrs.href)?.data ?? unfurlAttr;

  React.useEffect(() => {
    // The node view may be destroyed before the fetch resolves, in which case
    // the editor transaction in onChangeUnfurl must not be dispatched.
    let cancelled = false;

    const fetchProject = async () => {
      const unfurlModel = await unfurls.fetchUnfurl({ url: attrs.href });

      if (cancelled) {
        return;
      }

      if (unfurlModel) {
        onChangeUnfurl({
          ...unfurlModel.data,
          description: null,
        } satisfies UnfurlResponse[UnfurlResourceType.Project]);
      }

      setLoaded(true);
    };

    void fetchProject();

    return () => {
      cancelled = true;
    };
  }, [unfurls, attrs.href, onChangeUnfurl]);

  if (!unfurl) {
    return !loaded ? (
      <MentionLoading className={className} />
    ) : (
      <MentionError className={className} />
    );
  }

  const project = unfurl as UnfurlResponse[UnfurlResourceType.Project];

  return (
    <a
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
      href={attrs.href as string}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      <Flex align="center" gap={6}>
        {project.avatarUrl ? (
          <ProjectAvatar src={sanitizeImageSrc(project.avatarUrl)} alt="" />
        ) : (
          <Squircle color={project.color} size={12} />
        )}
        <Flex align="center" gap={4}>
          <Text>
            <Backticks content={project.name} />
          </Text>
          <Text type="tertiary">
            {project.progress !== undefined
              ? `${Math.round(project.progress * 100)}%`
              : project.id}
          </Text>
        </Flex>
      </Flex>
    </a>
  );
});

export const MentionPullRequest = observer((props: IssuePrProps) => {
  const { unfurls } = useStores();
  const [loaded, setLoaded] = React.useState(false);
  const onChangeUnfurl = React.useRef(props.onChangeUnfurl).current; // stable reference to callback function.

  const { isSelected, node } = props;
  const {
    className,
    unfurl: unfurlAttr,
    ...attrs
  } = getAttributesFromNode(node);

  const unfurl = unfurls.get(attrs.href)?.data ?? unfurlAttr;

  React.useEffect(() => {
    // The node view may be destroyed before the fetch resolves, in which case
    // the editor transaction in onChangeUnfurl must not be dispatched.
    let cancelled = false;

    const fetchPR = async () => {
      const unfurlModel = await unfurls.fetchUnfurl({ url: attrs.href });

      if (cancelled) {
        return;
      }

      if (unfurlModel) {
        onChangeUnfurl({
          ...unfurlModel.data,
          description: null,
        } satisfies UnfurlResponse[UnfurlResourceType.PR]);
      }

      setLoaded(true);
    };

    void fetchPR();

    return () => {
      cancelled = true;
    };
  }, [unfurls, attrs.href, onChangeUnfurl]);

  const sharedProps = {
    className: cn(className, {
      "ProseMirror-selectednode": isSelected,
    }),
  };

  if (!unfurl) {
    return !loaded ? (
      <MentionLoading {...sharedProps} />
    ) : (
      <MentionError {...sharedProps} />
    );
  }

  const pullRequest = unfurl as UnfurlResponse[UnfurlResourceType.PR];

  return (
    <a
      {...attrs}
      {...sharedProps}
      href={attrs.href as string}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      <Flex align="center" gap={6}>
        <PullRequestIcon size={14} state={pullRequest.state} />
        <Flex align="center" gap={4}>
          <Text>
            <Backticks content={pullRequest.title} />
          </Text>
          <Text type="tertiary">{pullRequest.id}</Text>
        </Flex>
      </Flex>
    </a>
  );
});

type DateProps = ComponentProps & {
  onChangeDate: (modelId: string) => void;
};

// Loaded lazily so its browser-only dependencies (Radix, react-day-picker)
// don't enter the editor schema's static import graph, which is also used on
// the server.
const DateMentionPicker = lazyWithRetry(() => import("./DateMentionPicker"));

export const MentionDate = observer(function MentionDate_(props: DateProps) {
  const { isSelected, isEditable, node, onChangeDate } = props;
  const { t } = useTranslation();
  const { auth } = useStores();
  const { className, unfurl, ...attrs } = getAttributesFromNode(node);

  const language = auth.user?.language;
  const iso = typeof node.attrs.modelId === "string" ? node.attrs.modelId : "";
  const display = dateToRelativeReadable(iso, t, language);
  const selectedDate = parseISODate(iso) ?? undefined;

  const content = (
    <DateMention
      {...attrs}
      className={cn(className, {
        "ProseMirror-selectednode": isSelected,
      })}
      $editable={isEditable}
    >
      {display}
    </DateMention>
  );

  if (!isEditable) {
    return content;
  }

  return (
    <React.Suspense fallback={content}>
      <DateMentionPicker
        selectedDate={selectedDate}
        includeTime={hasTimeComponent(iso)}
        language={language}
        onChange={onChangeDate}
      >
        {content}
      </DateMentionPicker>
    </React.Suspense>
  );
});

interface PluginIssueMentionProps extends IssueMentionProps {
  /** The plugin renderer that matched the mention's URL. */
  renderer: IssueRenderer;
}

/**
 * Renders an issue mention with a plugin's component. While the component
 * loads a spinner is shown, and if it fails the mention falls back to a link.
 */
const PluginIssueMention = ({
  renderer,
  ...props
}: PluginIssueMentionProps) => (
  <RendererBoundary
    key={props.href}
    href={props.href}
    fallback={
      <a
        {...props.attrs}
        className={props.className}
        href={props.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {props.label}
      </a>
    }
  >
    <React.Suspense fallback={<MentionLoading className={props.className} />}>
      <renderer.Mention.Component {...props} />
    </React.Suspense>
  </RendererBoundary>
);

interface RendererBoundaryProps {
  /** The URL of the mention, logged with the error. */
  href: string;
  /** Rendered in place of the children once they have thrown. */
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface RendererBoundaryState {
  hasError: boolean;
}

/**
 * Contains errors from a plugin renderer, including a chunk that failed to
 * load, so that they do not reach the editor.
 */
class RendererBoundary extends React.Component<
  RendererBoundaryProps,
  RendererBoundaryState
> {
  public static getDerivedStateFromError(): RendererBoundaryState {
    return { hasError: true };
  }

  public state: RendererBoundaryState = { hasError: false };

  public componentDidCatch(error: Error) {
    // React logs the error without the mention it came from. Shared code
    // cannot use the app's logger.
    // oxlint-disable-next-line no-console
    console.error("Failed to render plugin issue mention", {
      href: this.props.href,
      error,
    });
  }

  public render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

const MentionLoading = ({ className }: { className: string }) => {
  const { t } = useTranslation();

  return (
    <span className={className}>
      <Spinner />
      <Text type="tertiary">{`${t("Loading")}…`}</Text>
    </span>
  );
};

const MentionError = ({ className }: { className: string }) => {
  const { t } = useTranslation();

  return (
    <span className={className}>
      <StyledWarningIcon size={20} color={theme.danger} />
      <Text type="secondary">{`${t("Error loading data")}`}</Text>
    </span>
  );
};

const DateMention = styled.span<{ $editable: boolean }>`
  cursor: ${(props) => (props.$editable ? "pointer" : "default")};
  user-select: none;
`;

const StyledWarningIcon = styled(WarningIcon)`
  margin: 0 -2px;
`;

const Logo = styled.img`
  width: 16px;
  height: 16px;
`;

const ProjectAvatar = styled.img`
  width: 12px;
  height: 12px;
  border-radius: 2px;
`;
