import type { Node } from "prosemirror-model";
import { Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { v4 as uuidv4 } from "uuid";
import {
  IntegrationService,
  IntegrationType,
  MentionType,
} from "@shared/types";
import { doc, p, parser, schema } from "@shared/test/editor";
import type { Editor } from "~/editor";
import stores from "~/stores";
import type { Plugin } from "~/utils/PluginManager";
import { Hook, PluginManager } from "~/utils/PluginManager";
import PasteHandler from "./PasteHandler";

const cardUrl = "https://acme.codecks.io/card/16a-a-card";
const otherCardUrl = "https://acme.codecks.io/card/16b-another-card";
const plainUrl = "https://example.com/page";

const cardProvider: Plugin<Hook.MentionProvider>["value"] = {
  service: IntegrationService.Codecks,
  pasteAsMention: true,
  isMentionable: (url) => url.hostname === "acme.codecks.io",
  mentionType: () => MentionType.URL,
};

interface TestEditor {
  handler: PasteHandler;
  view: EditorView;
}

/**
 * Creates a paste handler bound to a view of the document, with the cursor at
 * the given position. Only the parts of the editor that pasting reads are
 * provided.
 */
function createEditor(content: Node, pos: number): TestEditor {
  const handler = new PasteHandler();
  const state = EditorState.create({
    schema,
    doc: content,
    plugins: handler.plugins,
  });
  const view = new EditorView(document.createElement("div"), {
    state: state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos))
    ),
  });
  const editor: Pick<Editor, "view" | "schema" | "pasteParser"> = {
    view,
    schema,
    pasteParser: parser,
  };
  handler.bindEditor(editor as Editor);
  return { handler, view };
}

function paste({ view }: TestEditor, text: string) {
  const clipboardData: Pick<DataTransfer, "getData"> = {
    getData: (format) => (format === "text/plain" ? text : ""),
  };
  const event: Pick<ClipboardEvent, "preventDefault"> & {
    clipboardData: Pick<DataTransfer, "getData"> | null;
  } = { clipboardData, preventDefault: () => undefined };

  return view.someProp("handlePaste", (handlePaste) =>
    handlePaste(view, event as ClipboardEvent, Slice.empty)
  );
}

function holdShift({ view }: TestEditor) {
  const event = new KeyboardEvent("keydown", { key: "Shift", shiftKey: true });
  view.someProp("handleDOMEvents", (handlers) =>
    handlers.keydown?.(view, event)
  );
}

function findMentions(content: Node) {
  const mentions: Node[] = [];
  content.descendants((node) => {
    if (node.type.name === "mention") {
      mentions.push(node);
    }
  });
  return mentions;
}

function hasLinkTo(content: Node, href: string) {
  let found = false;
  content.descendants((node) => {
    if (node.marks.some((mark) => mark.attrs.href === href)) {
      found = true;
    }
  });
  return found;
}

describe("PasteHandler", () => {
  beforeEach(() => {
    vi.spyOn(PluginManager, "getHooks").mockReturnValue([
      {
        id: "test-mention-provider",
        name: "Test mention provider",
        type: Hook.MentionProvider,
        priority: 0,
        value: cardProvider,
      },
    ]);
    stores.integrations.add({
      id: uuidv4(),
      type: IntegrationType.Embed,
      service: IntegrationService.Codecks,
      settings: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stores.integrations.clear();
  });

  describe("a single URL", () => {
    it("inserts a mention followed by a space when the provider asks for it", () => {
      const editor = createEditor(doc(p("See ")), 5);

      expect(paste(editor, `${cardUrl}\n`)).toBe(true);

      const [mention] = findMentions(editor.view.state.doc);
      expect(mention?.attrs).toMatchObject({
        type: MentionType.URL,
        href: cardUrl,
        label: cardUrl,
      });
      expect(mention?.attrs.id).toBeTruthy();
      expect(mention?.attrs.modelId).toBeTruthy();
      const paragraph = editor.view.state.doc.firstChild;
      expect(paragraph?.childCount).toBe(3);
      expect(paragraph?.child(1)).toBe(mention);
      expect(paragraph?.child(2).text).toBe(" ");
      expect(editor.handler.state.open).toBe(false);
    });

    it("inserts a link and shows the paste menu inside a link", () => {
      const link = schema.marks.link.create({ href: plainUrl });
      const editor = createEditor(
        doc(schema.nodes.paragraph.create(null, schema.text("linked", [link]))),
        3
      );

      paste(editor, cardUrl);

      expect(findMentions(editor.view.state.doc)).toHaveLength(0);
      expect(hasLinkTo(editor.view.state.doc, cardUrl)).toBe(true);
      expect(editor.handler.state.open).toBe(true);
    });

    it("inserts a link and shows the paste menu for other URLs", () => {
      const editor = createEditor(doc(p("")), 1);

      paste(editor, plainUrl);

      expect(findMentions(editor.view.state.doc)).toHaveLength(0);
      expect(hasLinkTo(editor.view.state.doc, plainUrl)).toBe(true);
      expect(editor.handler.state.open).toBe(true);
      expect(editor.handler.state.pastedText).toBe(plainUrl);
    });

    it("inserts a link and shows the paste menu without an integration", () => {
      stores.integrations.clear();
      const editor = createEditor(doc(p("")), 1);

      paste(editor, cardUrl);

      expect(findMentions(editor.view.state.doc)).toHaveLength(0);
      expect(editor.handler.state.open).toBe(true);
    });

    it("pastes a plain link while Shift is held", () => {
      const editor = createEditor(doc(p("")), 1);
      holdShift(editor);

      paste(editor, cardUrl);

      expect(findMentions(editor.view.state.doc)).toHaveLength(0);
      expect(editor.view.state.doc.textContent).toBe(cardUrl);
      expect(editor.handler.state.open).toBe(false);
    });
  });

  describe("a list of URLs", () => {
    it("converts the list to mentions when every URL is one", () => {
      const editor = createEditor(doc(p("")), 1);

      paste(editor, `- ${cardUrl}\n- ${otherCardUrl}`);

      const mentions = findMentions(editor.view.state.doc);
      expect(mentions.map((mention) => mention.attrs.href)).toEqual([
        cardUrl,
        otherCardUrl,
      ]);
      expect(
        mentions.every((mention) => mention.attrs.type === MentionType.URL)
      ).toBe(true);
      expect(editor.handler.state.open).toBe(false);
    });

    it("keeps the paste menu for a list that mixes them with other links", () => {
      const editor = createEditor(doc(p("")), 1);

      paste(editor, `- ${cardUrl}\n- ${plainUrl}`);

      expect(findMentions(editor.view.state.doc)).toHaveLength(0);
      expect(editor.handler.state.open).toBe(true);
      expect(editor.handler.state.pastedText).toEqual([cardUrl, plainUrl]);
    });

    it("does not convert the list while Shift is held", () => {
      const editor = createEditor(doc(p("")), 1);
      holdShift(editor);

      paste(editor, `- ${cardUrl}\n- ${otherCardUrl}`);

      expect(findMentions(editor.view.state.doc)).toHaveLength(0);
    });
  });
});
