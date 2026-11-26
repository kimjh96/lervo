/** One item of a context menu: an action, or a note when it has no `run`. */
export interface MenuItem {
  readonly text: string;
  readonly run?: () => void;
  /** The item's keyboard shortcut as the system menu shows it, such as `CmdOrCtrl+O`. */
  readonly shortcut?: string;
}

/** The system's context menu, shown at the pointer (Lervo ADE projects, "The switcher"). */
export interface Menus {
  /** Shows the items in order; `"separator"` draws a line between groups. */
  show(items: readonly (MenuItem | "separator")[]): Promise<void>;
}
