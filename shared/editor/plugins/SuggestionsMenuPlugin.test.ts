import { observable } from "mobx";
import type { EditorView } from "prosemirror-view";
import { createEditorStateWithSelection, doc, p } from "@shared/test/editor";
import type { ExtensionState } from "./SuggestionsMenuPlugin";
import { SuggestionsMenuPlugin } from "./SuggestionsMenuPlugin";

const openRegex = /(?:^|\s)\$([\p{L}\d]+)?$/u;

function createExtensionState() {
  return observable<ExtensionState>({
    open: false,
    query: "",
    trigger: null,
    triggerPos: null,
  });
}

function createPlugin(
  extensionState: ExtensionState,
  isEnabled: () => boolean
) {
  return new SuggestionsMenuPlugin(
    extensionState,
    openRegex,
    true,
    1,
    true,
    isEnabled
  );
}

/**
 * The handlers only read the state and composing flag of the view, so a plain
 * object stands in for a DOM-backed view, with the cursor after the text.
 */
function createView(text: string) {
  const view: Pick<EditorView, "state" | "composing"> = {
    state: createEditorStateWithSelection(doc(p(text)), text.length + 1),
    composing: false,
  };
  return view as EditorView;
}

function keyDown(key: string) {
  const event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey"> = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  };
  return event as KeyboardEvent;
}

function compositionUpdate() {
  const event: Pick<CompositionEvent, "data"> = { data: "$" };
  return event as CompositionEvent;
}

function pressKey(
  plugin: SuggestionsMenuPlugin,
  view: EditorView,
  key: string
) {
  return plugin.props.handleKeyDown?.call(plugin, view, keyDown(key));
}

function compose(plugin: SuggestionsMenuPlugin, view: EditorView) {
  return plugin.props.handleDOMEvents?.compositionupdate?.call(
    plugin,
    view,
    compositionUpdate()
  );
}

describe("SuggestionsMenuPlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when enabled", () => {
    it("should open when the trigger is typed", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => true);

      pressKey(plugin, createView("Total $"), "$");
      vi.runAllTimers();

      expect(extensionState.open).toBe(true);
      expect(extensionState.trigger).toBe("$");
      expect(extensionState.query).toBe("");
      expect(extensionState.triggerPos).toBe(7);
    });

    it("should open when the trigger is composed", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => true);

      compose(plugin, createView("Total $"));
      vi.runAllTimers();

      expect(extensionState.open).toBe(true);
    });

    it("should capture navigation keys while open", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => true);
      const view = createView("Total $");
      extensionState.open = true;

      for (const key of ["Enter", "ArrowUp", "ArrowDown", "Tab"]) {
        expect(pressKey(plugin, view, key)).toBe(true);
      }
    });

    it("should not capture Enter while closed", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => true);

      expect(pressKey(plugin, createView("Total $"), "Enter")).toBe(false);
    });

    it("should default to enabled", () => {
      const extensionState = createExtensionState();
      const plugin = new SuggestionsMenuPlugin(
        extensionState,
        openRegex,
        true,
        1,
        true
      );

      pressKey(plugin, createView("Total $"), "$");
      vi.runAllTimers();

      expect(extensionState.open).toBe(true);
    });
  });

  describe("when disabled", () => {
    it("should not open when the trigger is typed", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => false);

      pressKey(plugin, createView("Total $"), "$");
      vi.runAllTimers();

      expect(extensionState.open).toBe(false);
    });

    it("should not open when the trigger is composed", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => false);

      compose(plugin, createView("Total $"));
      vi.runAllTimers();

      expect(extensionState.open).toBe(false);
    });

    it("should check whether it is enabled when the key is handled", () => {
      const extensionState = createExtensionState();
      let enabled = true;
      const plugin = createPlugin(extensionState, () => enabled);
      const view = createView("Total $");

      pressKey(plugin, view, "$");
      compose(plugin, view);
      enabled = false;
      vi.runAllTimers();

      expect(extensionState.open).toBe(false);
    });

    it("should not capture navigation keys when left open", () => {
      const extensionState = createExtensionState();
      const plugin = createPlugin(extensionState, () => false);
      const view = createView("Total $");
      extensionState.open = true;

      for (const key of ["Enter", "ArrowUp", "ArrowDown", "Tab"]) {
        expect(pressKey(plugin, view, key)).toBe(false);
      }
    });
  });
});
