import { pick } from "es-toolkit";
import type { Node, Schema } from "prosemirror-model";
import type { Primitive } from "utility-types";
import { v4 as uuidv4 } from "uuid";
import { UnfurlResourceType, type UnfurlResponse } from "../../types";
import { isList } from "../queries/isList";
import type { IssueRenderer } from "../types";

/**
 * Reduces an unfurl to the shape stored on a mention node, where every viewer
 * of the document can read it. Issue unfurls go through the plugin renderer's
 * reducer when it has one, otherwise only the core issue fields are kept, so
 * service specific extensions are never stored. Descriptions of issues and
 * pull requests are dropped.
 *
 * @param data the unfurl returned for the current viewer.
 * @param renderer the plugin renderer for the mention's URL, if any.
 * @returns the unfurl to store on the node, or undefined to store nothing.
 */
export function toPersistedUnfurl(
  data: UnfurlResponse[keyof UnfurlResponse],
  renderer?: Pick<IssueRenderer, "persistedUnfurl">
): UnfurlResponse[keyof UnfurlResponse] | undefined {
  if (data.type === UnfurlResourceType.Issue) {
    if (renderer?.persistedUnfurl) {
      return renderer.persistedUnfurl(data);
    }

    return { ...pick(data, persistedIssueKeys), description: null };
  }

  if (data.type === UnfurlResourceType.PR) {
    return { ...data, description: null };
  }

  return data;
}

export function transformListToMentions(
  listNode: Node,
  schema: Schema,
  attrs: Record<string, Primitive>
): Node {
  const childNodes: Node[] = [];

  listNode.forEach((node) => {
    childNodes.push(transformListItemToMentions(node, schema, attrs));
  });

  return listNode.type.create(listNode.attrs, childNodes);
}

function transformListItemToMentions(
  listItemNode: Node,
  schema: Schema,
  attrs: Record<string, Primitive>
) {
  const childNodes: Node[] = [];

  listItemNode.forEach((node) => {
    if (node.type.name === "paragraph") {
      const link = node.textContent;
      const mentionType = attrs[link];

      if (mentionType) {
        childNodes.push(
          node.type.create(
            node.attrs,
            schema.nodes.mention.create({
              id: uuidv4(),
              type: mentionType,
              label: link,
              href: link,
              modelId: uuidv4(),
              actorId: attrs.actorId,
            })
          )
        );
      } else {
        childNodes.push(node);
      }
    } else if (isList(node, schema)) {
      const subListNode = transformListToMentions(node, schema, attrs);
      childNodes.push(subListNode);
    }
  });

  return listItemNode.type.create(listItemNode.attrs, childNodes);
}

/** The issue unfurl keys every service provides, persisted by default. */
const persistedIssueKeys = [
  "type",
  "url",
  "id",
  "title",
  "author",
  "labels",
  "state",
  "createdAt",
] as const;
