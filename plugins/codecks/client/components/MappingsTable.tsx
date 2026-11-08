import { observer } from "mobx-react";
import { PlusIcon, TrashIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import { breakpoint } from "@shared/styles/breakpoint";
import { errToString } from "@shared/utils/error";
import type Collection from "~/models/Collection";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import NudeButton from "~/components/NudeButton";
import Text from "~/components/Text";
import Tooltip from "~/components/Tooltip";
import useStores from "~/hooks/useStores";
import type { CodecksMapping, CodecksProject } from "../../shared/types";
import { CollectionSelect } from "./CollectionSelect";
import { DeckSwatch } from "./DeckSwatch";

interface Props {
  /** The projects the connected token can read, undefined until loaded. */
  projects: CodecksProject[] | undefined;
  /** The mappings as last saved. */
  mappings: CodecksMapping[];
  /** Stores the mappings, rejecting if they could not be saved. */
  onSave: (mappings: CodecksMapping[]) => Promise<void>;
}

/**
 * An editable list of Codecks project to collection mappings, each with an
 * optional default deck for new cards. Mappings whose project, collection or
 * deck no longer exists are flagged.
 */
export const MappingsTable = observer(function MappingsTable({
  projects,
  mappings,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const { collections } = useStores();
  const [rows, setRows] = React.useState<Row[]>(() =>
    mappings.map((mapping) => ({ key: uuidv4(), ...mapping }))
  );
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [collectionsLoaded, setCollectionsLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    collections
      .fetchAllIfNeeded()
      .catch(() => {
        toast.error(
          t("Collections could not be loaded. Please reload the app.")
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCollectionsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [collections, t]);

  const projectsById = React.useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects]
  );

  const projectOptions = React.useMemo(
    () =>
      (projects ?? []).map((project): Option => ({
        type: "item",
        label: project.name,
        value: project.id,
      })),
    [projects]
  );

  const handleChange = React.useCallback(
    (key: string, patch: Partial<Omit<Row, "key">>) => {
      setRows((current) =>
        current.map((row) => (row.key === key ? { ...row, ...patch } : row))
      );
      setDirty(true);
    },
    []
  );

  const handleRemove = React.useCallback((key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    setDirty(true);
  }, []);

  const handleAdd = React.useCallback(() => {
    setRows((current) => [
      ...current,
      {
        key: uuidv4(),
        projectId: "",
        projectName: "",
        collectionId: "",
        defaultDeckId: null,
      },
    ]);
    setDirty(true);
  }, []);

  const duplicates = getDuplicateKeys(rows);
  const canSave =
    dirty &&
    !saving &&
    rows.every(
      (row) =>
        !getBlockingProblem(row, {
          project: projectsById.get(row.projectId),
          projectsLoaded: !!projects,
          collection: collections.get(row.collectionId),
          collectionsLoaded,
          duplicate: duplicates.has(row.key),
        })
    );

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        rows.map((row) => ({
          projectId: row.projectId,
          projectName: projectsById.get(row.projectId)?.name ?? row.projectName,
          collectionId: row.collectionId,
          defaultDeckId: row.defaultDeckId,
        }))
      );
      setDirty(false);
      toast.success(t("Settings saved"));
    } catch (err) {
      toast.error(errToString(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {rows.length > 0 ? (
        <Rows>
          <HeaderRow aria-hidden="true">
            <Columns>
              <ColumnHeading>{t("Project")}</ColumnHeading>
              <ColumnHeading>{t("Collection")}</ColumnHeading>
              <ColumnHeading>{t("Default deck")}</ColumnHeading>
            </Columns>
            <ActionSpacer />
          </HeaderRow>
          {rows.map((row) => (
            <MappingRow
              key={row.key}
              row={row}
              project={projectsById.get(row.projectId)}
              projectOptions={projectOptions}
              projectsLoaded={!!projects}
              collectionsLoaded={collectionsLoaded}
              duplicate={duplicates.has(row.key)}
              disabled={saving}
              onChange={handleChange}
              onRemove={handleRemove}
            />
          ))}
        </Rows>
      ) : (
        <Text as="p" type="tertiary">
          {t(
            "No projects are mapped yet. Members will not see card details until a project is mapped to a collection they can access."
          )}
        </Text>
      )}
      <Actions justify="space-between" gap={8}>
        <Button
          neutral
          icon={<PlusIcon />}
          onClick={handleAdd}
          disabled={saving || !projects}
        >
          {t("Add mapping")}
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {saving ? `${t("Saving")}…` : t("Save")}
        </Button>
      </Actions>
    </>
  );
});

/** A mapping being edited, the IDs of a new row are empty until chosen. */
interface Row extends CodecksMapping {
  key: string;
}

interface RowContext {
  project: CodecksProject | undefined;
  projectsLoaded: boolean;
  collection: Collection | undefined;
  collectionsLoaded: boolean;
  duplicate: boolean;
}

enum Problem {
  Incomplete = "incomplete",
  ProjectUnavailable = "projectUnavailable",
  CollectionUnavailable = "collectionUnavailable",
  Duplicate = "duplicate",
}

function getBlockingProblem(
  row: Row,
  context: RowContext
): Problem | undefined {
  if (context.projectsLoaded && row.projectId && !context.project) {
    return Problem.ProjectUnavailable;
  }
  if (
    context.collectionsLoaded &&
    row.collectionId &&
    (!context.collection ||
      !context.collection.isActive ||
      context.collection.isPersonal)
  ) {
    return Problem.CollectionUnavailable;
  }
  if (!row.projectId || !row.collectionId) {
    return Problem.Incomplete;
  }
  if (context.duplicate) {
    return Problem.Duplicate;
  }
  return undefined;
}

function getDuplicateKeys(rows: Row[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const id = `${row.projectId}:${row.collectionId}`;
    if (row.projectId && row.collectionId && seen.has(id)) {
      duplicates.add(row.key);
    }
    seen.add(id);
  }
  return duplicates;
}

interface MappingRowProps {
  row: Row;
  project: CodecksProject | undefined;
  projectOptions: Option[];
  projectsLoaded: boolean;
  collectionsLoaded: boolean;
  duplicate: boolean;
  disabled: boolean;
  onChange: (key: string, patch: Partial<Omit<Row, "key">>) => void;
  onRemove: (key: string) => void;
}

const NoDeck = "none";

const MappingRow = observer(function MappingRow({
  row,
  project,
  projectOptions,
  projectsLoaded,
  collectionsLoaded,
  duplicate,
  disabled,
  onChange,
  onRemove,
}: MappingRowProps) {
  const { t } = useTranslation();
  const { collections } = useStores();
  const { key } = row;
  const messageId = React.useId();
  const problem = getBlockingProblem(row, {
    project,
    projectsLoaded,
    collection: collections.get(row.collectionId),
    collectionsLoaded,
    duplicate,
  });
  const deckUnavailable =
    !!project &&
    !!row.defaultDeckId &&
    !project.decks.some((deck) => deck.id === row.defaultDeckId);

  // Keep a project that is no longer listed selectable, so the row shows
  // what it was saved with until it is changed or removed.
  const rowProjectOptions = React.useMemo(
    (): Option[] =>
      row.projectId && !project
        ? [
            {
              type: "item",
              label: row.projectName || row.projectId,
              value: row.projectId,
            },
            ...projectOptions,
          ]
        : projectOptions,
    [row.projectId, row.projectName, project, projectOptions]
  );

  const deckOptions = React.useMemo(
    (): Option[] => [
      { type: "item", label: t("No default deck"), value: NoDeck },
      ...(project?.decks ?? []).map((deck): Option => ({
        type: "item",
        label: deck.title,
        value: deck.id,
        icon: <DeckSwatch color={deck.coverColor} size={12} />,
      })),
    ],
    [project, t]
  );

  const handleProjectChange = React.useCallback(
    (projectId: string) => {
      if (projectId !== row.projectId) {
        onChange(key, { projectId, defaultDeckId: null });
      }
    },
    [key, row.projectId, onChange]
  );

  const handleCollectionChange = React.useCallback(
    (collectionId: string) => onChange(key, { collectionId }),
    [key, onChange]
  );

  const handleDeckChange = React.useCallback(
    (deckId: string) =>
      onChange(key, { defaultDeckId: deckId === NoDeck ? null : deckId }),
    [key, onChange]
  );

  const handleRemove = React.useCallback(() => onRemove(key), [key, onRemove]);

  let message: string | undefined;
  switch (problem) {
    case Problem.ProjectUnavailable:
      message = t(
        "This project is no longer available to the connected token. Choose another project or remove the mapping."
      );
      break;
    case Problem.CollectionUnavailable:
      message = t(
        "This collection no longer exists or has been archived. Choose another collection or remove the mapping."
      );
      break;
    case Problem.Duplicate:
      message = t("This project is already mapped to this collection.");
      break;
    default:
      message = deckUnavailable
        ? t("The default deck no longer exists in this project.")
        : undefined;
  }

  return (
    <div
      role="group"
      aria-label={project?.name || row.projectName || t("New mapping")}
      aria-describedby={message ? messageId : undefined}
    >
      <RowLayout>
        <Columns>
          <InputSelect
            options={rowProjectOptions}
            value={row.projectId || null}
            onChange={handleProjectChange}
            label={t("Project")}
            labelHidden
            disabled={disabled}
          />
          <CollectionSelect
            value={row.collectionId || null}
            onChange={handleCollectionChange}
            disabled={disabled}
          />
          <InputSelect
            options={deckOptions}
            value={row.defaultDeckId ?? NoDeck}
            onChange={handleDeckChange}
            label={t("Default deck")}
            labelHidden
            disabled={disabled || !project}
          />
        </Columns>
        <Tooltip content={t("Remove mapping")}>
          <NudeButton
            aria-label={t("Remove mapping")}
            onClick={handleRemove}
            disabled={disabled}
          >
            <TrashIcon />
          </NudeButton>
        </Tooltip>
      </RowLayout>
      {message && (
        <Message id={messageId} as="p" type="danger" size="xsmall">
          {message}
        </Message>
      )}
    </div>
  );
});

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
`;

const RowLayout = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const HeaderRow = styled(RowLayout)`
  ${breakpoint("mobile", "tablet")`
    display: none;
  `}
`;

const Columns = styled.div`
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  ${breakpoint("mobile", "tablet")`
    grid-template-columns: minmax(0, 1fr);
  `}
`;

const ColumnHeading = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: ${(props) => props.theme.textSecondary};
`;

const ActionSpacer = styled.div`
  width: 24px;
  flex-shrink: 0;
`;

const Message = styled(Text)`
  margin: 4px 0 0;
`;

const Actions = styled(Flex)`
  margin-top: 8px;
`;
