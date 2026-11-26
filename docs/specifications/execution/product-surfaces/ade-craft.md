# Lervo ADE craft rules

Status: `active`
As of: 2026-11-26

This chapter of the [design system](ade-design-system.md) turns the finish the owner expects into rules that a change either meets or fails. The owner asked for it on 2026-11-26, after a project dialog, a menu, and first-run cards shipped as opaque panels outlined in lines, with buttons of different sizes, a location shown as a cut-off path, and motion that played unseen. The rules apply to every surface of the ADE, not only to menus and dialogs. The [visual language](ade-visual-language.md) holds the values, and [ADE motion](ade-motion.md) holds the motion. This chapter says how to combine them.

## Surfaces

1. **Floating surfaces are glass.** A menu, popover, dialog, floating card, or floating button sits on `color.surface.floating` with the overlay blur (`glass.overlay.blur` and its saturation). Its edge is the light of `color.border.window`, and its depth is `shadow.window`. A floating surface is never an opaque fill outlined with `color.border.default`.
2. **Surfaces on the window glass are separated by fill and light, not by drawn boxes.** A card, choice, or field on the window uses a surface token with a faint inset edge of `color.border.subtle` and `shadow.raised`. An outline in `color.border.default` appears only where the window's own controls already use it, such as the start card. A focused field shows the accent edge.
3. **A modal blurs what is behind it.** Behind a dialog, the window blurs and a light veil of `glass.tint.color` covers it, as the image viewer does. A flat gray scrim alone is not used.
4. **Reduced transparency falls back.** Every glass surface switches to `color.surface.opaque` under `prefers-reduced-transparency: reduce`, with nothing else changed.

## Controls

5. **One group, one size.** Controls that sit together share one height, one corner, and one type. Text fields and buttons shaped like fields use `size.control.lg` and `radius.md`. The buttons of one row also share `layout.buttonMinWidth`. The rows of a list start their labels at one edge: an icon or mark sits centered in one leading column (`size.row.leading`), whatever its own size. One image at two sizes keeps one shape, so a mark's corner is about a quarter of its size (`radius.mark.*`).
6. **Primary and secondary differ only in fill.** The primary button is the accent fill with `color.on-accent` text. A secondary button is the hover surface, without an outline. Disabled buttons use `opacity.disabled`, never another shape.
7. **Actions are named, never guessed.** When a choice has several outcomes, each is a named action, such as "Open Folder", "Clone Repository", and "New Project". One field never decides between outcomes from what was typed, unless only one outcome is possible.
8. **Locations show the folder's name.** A folder is shown as the system's save panel shows it: a folder icon and the folder's own name, such as "Lervo", in one button that opens the system folder panel. The full path is its tooltip. A path is never shown cut off inside a sentence.
9. **Labels follow the platform.** Menu items and window titles are in title case, as macOS writes them. Other text is in sentence case. No label ends in an ellipsis ([ADE design patterns](ade-design-patterns.md), "Waiting"). Short text that wraps, such as a card's detail, wraps balanced, so no line holds a single word.

## Placement

10. **A menu hangs from its control.** A menu opens directly below the control that opened it, 4 px apart, aligned to its leading edge, and at least as wide as the control. As in a macOS menu, no item is chosen until the pointer or a key chooses one, except that a menu a key opened starts on its first item.
11. **A dialog is centered.** A dialog sits in the middle of the window. Nothing it covers shows half-hidden beside it.
12. **A small edit stays in place, and a creation gets a window.** A rename edits the name in its row. Adding something that needs fields opens a dialog. No panel floats across the boundary between the sidebar and the content.
13. **Nothing moves into place.** A view shows only once what it shows is known. A placeholder that later data replaces and shifts is not drawn: the start screen stays empty until the lists are known. An action that cannot work yet does not show: "New work" appears once a project exists.

## Motion

14. **Overlays keep their motion visible.** An overlay opens as [ADE motion](ade-motion.md)'s "Overlays" row says. WebKit draws no backdrop blur on an element whose opacity animates. An opening glass surface therefore keeps its glass from the first frame and rises from 0.98, its content fades, and the backdrop's blur eases in by its own radius. Closing, everything fades.
15. **The interface's own menu opens the interface's windows.** The system menu freezes the window for a moment after it closes, so a window it opened would play its motion unseen. A menu whose items open a dialog or another overlay is the interface's own (`ui/PopoverMenu`). The system menu stays for actions that open no overlay, such as a project's context menu.
16. **Space opens and closes.** What arrives or leaves moves the space around it ([ADE motion](ade-motion.md), principle 12).

## Verification

17. **Every visual change is checked in the real app.** The change runs in the ADE's real window and is captured state by state, in light and dark. Each motion is recorded and read frame by frame: an opening, closing, or arriving element shows its intermediate frames and never jumps in one frame.
18. **A mockup uses the real tokens and components.** A mockup is built from the token file and the shared components. A direction that cannot be built from them is not approved until they can express it.
19. **Mechanical rules are checked mechanically.** The motion check (`apps/ade/scripts/check-motion.mjs`) rejects an opening animation that fades an element with a backdrop blur, along with what it already rejects. The design value check rejects literal values.
