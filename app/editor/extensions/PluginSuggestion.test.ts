import { baseKeymap } from "prosemirror-commands";
import { inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import ListItem from "@shared/editor/nodes/ListItem";
import { bulletList, doc, heading, p, schema } from "@shared/test/editor";
import { createLazyComponent } from "~/components/LazyLoad";
import type { Editor } from "~/editor";
import type { Plugin, PluginSuggestionMenuProps } from "~/utils/PluginManager";
import { Hook, PluginManager } from "~/utils/PluginManager";
import { PluginSuggestionExtension } from "./PluginSuggestion";

type SuggestionMenu = Plugin<Hook.SuggestionMenu>["value"];

const component = createLazyComponent(async () => ({ default: () => null }));

function createHook(
  value: Partial<SuggestionMenu> = {}
): Plugin<Hook.SuggestionMenu> {
  return {
    id: "test-cards",
    name: "Test cards",
    type: Hook.SuggestionMenu,
    priority: 0,
    value: {
      trigger: "$",
      allowSpaces: true,
      requireSearchTerm: false,
      component,
      ...value,
    },
  };
}

/**
 * Binds the extension to a view of the document with the cursor at its end.
 * The view has the extension's plugins and the keymaps that handle Enter in a
 * paragraph, heading or list item, which is all that the menu uses.
 */
function createView(extension: PluginSuggestionExtension, content: Node) {
  const state = EditorState.create({
    schema,
    doc: content,
    plugins: [
      ...extension.plugins,
      inputRules({
        rules: extension.inputRules({ type: schema.nodes.doc, schema }),
      }),
      keymap(new ListItem().keys({ type: schema.nodes.list_item })),
      keymap(baseKeymap),
    ],
  });
  const view = new EditorView(document.createElement("div"), {
    state: state.apply(state.tr.setSelection(Selection.atEnd(state.doc))),
  });
  const editor: Pick<Editor, "view"> = { view };
  extension.bindEditor(editor as Editor);
  return view;
}

/** Types the trigger at the cursor and lets the menu open. */
function typeTrigger(view: EditorView) {
  const { from, to } = view.state.selection;
  view.someProp("handleTextInput", (handleTextInput) =>
    handleTextInput(view, from, to, "$", () =>
      view.state.tr.insertText("$", from, to)
    )
  );
  view.dispatch(view.state.tr.insertText("$", from, to));
  vi.runAllTimers();
}

function getOnClose(extension: PluginSuggestionExtension) {
  const element = extension.widget({
    rtl: false,
    readOnly: false,
    isEditorFocused: true,
  });
  const { onClose }: Pick<PluginSuggestionMenuProps, "onClose"> = element.props;
  return onClose;
}

describe("PluginSuggestionExtension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is named after the hook and its first trigger", () => {
    expect(new PluginSuggestionExtension(createHook()).name).toBe(
      "test-cards-suggestion-$"
    );
    expect(
      new PluginSuggestionExtension(createHook({ trigger: ["€", "£"] })).name
    ).toBe("test-cards-suggestion-€");
  });

  it("is built from a hook registered with the plugin manager", () => {
    PluginManager.add({
      id: "test-registered-menu",
      name: "Registered menu",
      type: Hook.SuggestionMenu,
      value: createHook().value,
    });

    const hook = PluginManager.getHooks(Hook.SuggestionMenu).find(
      (plugin) => plugin.id === "test-registered-menu"
    );

    expect(hook?.priority).toBe(0);
    expect(hook && new PluginSuggestionExtension(hook).name).toBe(
      "test-registered-menu-suggestion-$"
    );
  });

  it("asks the hook whether the menu is enabled", () => {
    let enabled = false;
    const extension = new PluginSuggestionExtension(
      createHook({ isEnabled: () => enabled })
    );

    expect(extension.isEnabled()).toBe(false);
    enabled = true;
    expect(extension.isEnabled()).toBe(true);
  });

  it("is enabled when the hook does not say", () => {
    expect(new PluginSuggestionExtension(createHook()).isEnabled()).toBe(true);
  });

  describe("opening", () => {
    it("opens when the trigger is typed", () => {
      const extension = new PluginSuggestionExtension(createHook());
      const view = createView(extension, doc(p("Total: ")));

      typeTrigger(view);

      expect(extension.isOpen).toBe(true);
    });

    it("does not open while the hook disables it", () => {
      const extension = new PluginSuggestionExtension(
        createHook({ isEnabled: () => false })
      );
      const view = createView(extension, doc(p("Total: ")));

      typeTrigger(view);

      expect(extension.isOpen).toBe(false);
    });

    it("does not open when the hook disables it before the menu renders", () => {
      let enabled = true;
      const extension = new PluginSuggestionExtension(
        createHook({ isEnabled: () => enabled })
      );
      const view = createView(extension, doc(p("Total: ")));
      const { from, to } = view.state.selection;

      view.someProp("handleTextInput", (handleTextInput) =>
        handleTextInput(view, from, to, "$", () =>
          view.state.tr.insertText("$", from, to)
        )
      );
      enabled = false;
      vi.runAllTimers();

      expect(extension.isOpen).toBe(false);
    });
  });

  describe("closing", () => {
    it("closes without changing the document", () => {
      const extension = new PluginSuggestionExtension(createHook());
      const view = createView(extension, doc(p("Total: ")));
      typeTrigger(view);
      const before = view.state.doc;

      getOnClose(extension)();

      expect(extension.isOpen).toBe(false);
      expect(view.state.doc.eq(before)).toBe(true);
    });

    it("starts a new paragraph as Enter would", () => {
      const extension = new PluginSuggestionExtension(createHook());
      const view = createView(extension, doc(p("Total: ")));
      typeTrigger(view);

      getOnClose(extension)(true);

      expect(extension.isOpen).toBe(false);
      expect(view.state.doc.eq(doc([p("Total: $"), p("")]))).toBe(true);
      expect(view.state.selection.$from.parent.textContent).toBe("");
    });

    it("starts a new list item as Enter would", () => {
      const extension = new PluginSuggestionExtension(createHook());
      const view = createView(extension, doc(bulletList(["Total: "])));
      typeTrigger(view);

      getOnClose(extension)(true);

      expect(view.state.doc.eq(doc(bulletList(["Total: $", ""])))).toBe(true);
    });

    it("continues a heading with a paragraph as Enter would", () => {
      const extension = new PluginSuggestionExtension(createHook());
      const view = createView(extension, doc(heading("Total: ")));
      typeTrigger(view);

      getOnClose(extension)(true);

      expect(view.state.doc.eq(doc([heading("Total: $"), p("")]))).toBe(true);
    });
  });
});
