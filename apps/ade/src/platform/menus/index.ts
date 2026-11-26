import type { Menus } from "../../ports/menus";

/** How long a shown menu's resources stay, so an item's action arrives before they are freed. */
const RELEASE_AFTER_MS = 30_000;

/**
 * The system's context menu through Tauri's menu API, loaded on first use so it stays out of the
 * first bundle. An item without an action shows disabled, as a note.
 */
export function shellMenus(): Menus {
  return {
    // The window shows no new frame for a moment after the system menu closes, so an item never
    // opens an overlay of the interface: its motion would play unseen. Such choices use the
    // interface's own menu (`ui/PopoverMenu`).
    async show(items) {
      const { Menu, MenuItem, PredefinedMenuItem } = await import("@tauri-apps/api/menu");
      const built = await Promise.all(
        items.map((item) =>
          item === "separator"
            ? PredefinedMenuItem.new({ item: "Separator" })
            : MenuItem.new({
                text: item.text,
                enabled: item.run !== undefined,
                ...(item.shortcut === undefined ? {} : { accelerator: item.shortcut }),
                ...(item.run === undefined ? {} : { action: () => item.run?.() }),
              }),
        ),
      );
      const menu = await Menu.new({ items: built });
      await menu.popup();
      setTimeout(() => {
        for (const resource of [menu, ...built]) void resource.close().catch(() => undefined);
      }, RELEASE_AFTER_MS);
    },
  };
}
