import { action } from "mobx";
import { observer } from "mobx-react";
import * as React from "react";
import type { WidgetProps } from "@shared/editor/lib/Extension";
import type { SuggestionOptions } from "~/editor/extensions/Suggestion";
import Suggestion from "~/editor/extensions/Suggestion";
import type {
  Hook,
  Plugin,
  PluginSuggestionMenuProps,
} from "~/utils/PluginManager";

interface PluginSuggestionOptions extends SuggestionOptions {
  /** The plugin hook that registered the menu. */
  hook: Plugin<Hook.SuggestionMenu>;
}

/**
 * A suggestion menu registered by a plugin with Hook.SuggestionMenu. An
 * instance is bound for each hook when an editable editor initializes, and the
 * hook decides on every keystroke whether the menu may open.
 */
export class PluginSuggestionExtension extends Suggestion<PluginSuggestionOptions> {
  /**
   * Creates the extension for a plugin's suggestion menu.
   *
   * @param hook the plugin hook that registered the menu.
   */
  constructor(hook: Plugin<Hook.SuggestionMenu>) {
    // Extension's constructor resolves the options before subclass fields
    // exist, so everything derived from the hook is passed through them.
    super({
      hook,
      trigger: hook.value.trigger,
      allowSpaces: hook.value.allowSpaces,
      requireSearchTerm: hook.value.requireSearchTerm,
      enabledInMarks: hook.value.enabledInMarks,
      enabledInCode: false,
    });
  }

  // ExtensionManager keeps an extension only if this returns an element, so
  // it must always return one and leave the enabled check to the component.
  widget = ({ rtl }: WidgetProps) => (
    <PluginSuggestionWidget
      extension={this}
      rtl={rtl}
      isActive={this.state.open}
      search={this.state.query}
      onClose={this.handleClose}
    />
  );

  get name() {
    const { hook, trigger } = this.options;
    const firstTrigger = Array.isArray(trigger) ? trigger[0] : trigger;
    return `${hook.id}-suggestion-${firstTrigger}`;
  }

  /**
   * Whether the plugin currently allows its menu to open.
   *
   * @returns true if the menu may open.
   */
  public isEnabled(): boolean {
    return this.options.hook.value.isEnabled?.() ?? true;
  }

  // The menu prevents the default action of the Enter key that closed it, so
  // ProseMirror skips its keymaps. Once the menu is closed the key is run
  // through them here, so the new line is the one Enter makes at the cursor,
  // such as a new list item rather than a second paragraph in the same one.
  private handleClose = action((insertNewLine?: boolean) => {
    this.state.open = false;

    if (!insertNewLine) {
      return;
    }

    const { view } = this.editor;
    const enter = new KeyboardEvent("keydown", { key: "Enter" });
    const handled = view.someProp("handleKeyDown", (handleKeyDown) =>
      handleKeyDown(view, enter)
    );
    if (!handled) {
      view.dispatch(view.state.tr.split(view.state.selection.to));
    }
    view.focus();
  });
}

interface PluginSuggestionWidgetProps extends Omit<
  PluginSuggestionMenuProps,
  "trigger"
> {
  /** The extension that owns the menu. */
  extension: PluginSuggestionExtension;
}

const PluginSuggestionWidget = observer(function PluginSuggestionWidget_({
  extension,
  rtl,
  isActive,
  search,
  onClose,
}: PluginSuggestionWidgetProps) {
  const enabled = extension.isEnabled();

  // A menu disabled while open is no longer rendered, so nothing else would
  // close it.
  React.useEffect(() => {
    if (!enabled && isActive) {
      onClose();
    }
  }, [enabled, isActive, onClose]);

  if (!enabled) {
    return null;
  }

  const { Component } = extension.options.hook.value.component;

  return (
    <React.Suspense
      fallback={<LoadingMenu isActive={isActive} onClose={onClose} />}
    >
      <Component
        rtl={rtl}
        trigger={extension.options.trigger}
        isActive={isActive}
        search={search}
        onClose={onClose}
      />
    </React.Suspense>
  );
});

/**
 * Stands in for a menu whose code is still loading. The open menu keeps Enter
 * from reaching the editor, so it is closed here as the loaded menu would.
 */
function LoadingMenu({
  isActive,
  onClose,
}: Pick<PluginSuggestionMenuProps, "isActive" | "onClose">) {
  React.useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        onClose(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isActive, onClose]);

  return null;
}
