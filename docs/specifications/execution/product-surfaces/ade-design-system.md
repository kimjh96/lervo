# Lervo ADE design system

Status: `proposed`
As of: 2026-11-26

This specification is the entry to the design system of the Lervo ADE: its design language, its foundations, and how each is used. The ADE builds on it today. The planned documentation and introduction site build on it next. The token file, `apps/ade/src/design/tokens.json`, is canonical for values. This specification is canonical for what each value means and when to use it. The [visual language](ade-visual-language.md) and the [motion principles](ade-motion.md) are its color, type, and motion chapters. The [design system plan](../../../roadmap/ade/design-system.md) orders the work that completes it.

## Design language

Lervo makes AI-assisted repository work durable, inspectable, and portable, done locally, with evidence for what happened ([product vision](../../../product/vision.md)). The interface exists to let a person direct that work and trust what they see. Each principle below states what it asks of every screen.

### Calm by default

Attention belongs to the work, not to the interface.

- Nothing moves, glows, or changes color unless work changed. The working status is the only loop.
- Two colors carry status: working and needs-you. Finished work has no color, and failure uses its own color only where it happened.
- Surfaces stay quiet: restrained glass, surfaces told apart by fill and light rather than drawn lines, and no decoration ([craft rules](ade-craft.md)).

### Evidence before claims

The interface shows what Lervo verified and what it did not, and never more.

- Evidence states (`selected`, `loaded`, `injected`, `referenced`, `used`) stay visually distinct and are never merged into one "used" ([evidence language](../../../product/vision/execution/evidence-language.md)).
- Unknown reads as unknown, never as zero or as success.
- Results name their count and their limit, such as "3 checks passed" or "1 file changed, not committed".

### Codes, then words

A failure is data first.

- Every failure shows its stable code beside a plain explanation and, when one exists, the next step.
- The interface never replaces a failure with a state of its own, such as an empty list for an unreachable core.

### The repository is the source

What Lervo manages and what the user owns look different wherever both appear.

- Content that comes from the repository, such as instructions and decisions, links to its source.
- Lervo-managed blocks are marked as Lervo's. User-owned content is shown as the user wrote it.

### Act, then report, with undo

Lervo does not wait for approval; it makes effects reversible and reports them (AGENTS.md invariant 10).

- Consequential effects show an after-the-fact notice with an undo action, never an approval dialog.
- Missing credentials are a notice that names what is missing. Work that does not need them continues.

### Provider neutral

The interface is Lervo's, whichever agent runs.

- Capabilities decide what the interface offers. Provider names appear as labels, never as branding, and no screen branches on a provider.

### Local first, ready for more hosts

- One host needs no host identity on screen. When a second host takes part, every workspace and session shows its host.

### Essentials only

- Each element earns its place by a task the person does. A second way to do the same thing does not ship.
- Defaults are decided by Lervo's model, not asked for on the start screen.

## Tokens

### Sources and outputs

The DTCG token file is the one source. `scripts/build-tokens.mjs` resolves its aliases and generates the CSS custom properties, the motion durations, and the sizes script needs, such as icon sizes. The site will read another generated output from the same file. Components read only generated outputs, and a test fails when a committed output is stale.

### Tiers

| Tier      | Holds                                                                       | Named like                          | Who reads it                       |
| --------- | --------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------- |
| Primitive | Raw values: the palette, the size scale, font families                      | `palette.blue.500`, `size.34`       | Semantic and component tokens only |
| Semantic  | Roles: what a value is for                                                  | `color.text.secondary`, `type.meta` | Components and features            |
| Component | A value one component needs that no role describes, or one its states share | `button.primary.background.hover`   | That component only                |

- A component never reads a primitive. A feature never reads another component's tokens.
- A component token exists only when a semantic role does not describe the value. Most components need none.
- Modes, such as light and dark, live in the semantic tier through `dev.lervo.modes`. Primitives have one value.
- Increased contrast lives beside them through `dev.lervo.contrast`, a dark and a light value for the few tokens that change: the glass tint becomes opaque, secondary and tertiary text move a step toward primary, and borders strengthen. The build emits them under `prefers-contrast: more`.
- Semantic colors alias the palette with DTCG references, such as `{palette.blue.600}`. A translucent layer, such as `color.surface.sidebar`, keeps its own value, because it is a composite over glass that no solid primitive describes. Primitives never reach the stylesheet, so a component cannot read one.
- The semantic tier also names sizes and states that recur: `size.control.*`, `size.dot.*`, `size.icon.*`, `opacity.disabled`, `focus.ring.*`, `border.width.strong`, `font.weight.*`, and `motion.rise`.

### Naming

`<category>.<role>.<variant>.<state>`, with only the parts a token needs: `color.surface.selected`, `color.text.link`, `radius.md`, `motion.duration.enter`. Names describe purpose, never appearance: `color.status.needsYou`, not `color.amber`.

### Rules for values

- Every color, size, radius, font size, weight, line height, shadow, opacity, duration, and easing in a component comes from a token. `scripts/check-literals.mjs` enforces this in every stylesheet and component, and the interface tests run it, as they run the motion check.
- Allowed without a token: `0`, `1px` hairlines, `100%` and `0%`, `auto`, `transparent`, `currentColor`, alpha-only mask colors, and the collapse breakpoint in a media query, which CSS cannot read from a custom property. Components pass sizes, such as an icon's, as token names, never as numbers.
- A new token states its role in its `$description` and joins this specification's usage tables.

## Color

Each role has one purpose. The [visual language](ade-visual-language.md) lists the values and their measured contrast.

| Role                    | Use it for                                                                                | Do not use it for                                |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `color.surface.*`       | The layers of the window, from the sidebar to floating controls, each named for its layer | Emphasis or status                               |
| `color.text.primary`    | Content the person reads to act: messages, titles, the instruction                        | Hints and labels                                 |
| `color.text.secondary`  | Supporting text: explanations, quiet rows, source labels                                  | Content a decision depends on                    |
| `color.text.tertiary`   | Labels, hints, timestamps, placeholders, identifiers beside a title                       | Anything the person must read to act             |
| `color.text.link`       | Inline actions inside text, such as "View diff"                                           | Buttons or decoration                            |
| `color.accent`          | The primary action, focus rings, selection, and the logo's last bar                       | Decoration, headings, or a second primary action |
| `color.status.working`  | The working dot and the working line                                                      | Anything not in progress                         |
| `color.status.needsYou` | A workspace or question that waits for the person, and the question bar                   | Warnings that need no action                     |
| `color.status.failed`   | A stage, request, or session that failed, at the place it failed                          | Destructive buttons or emphasis                  |
| `color.diff.*`          | Added and removed lines in diffs                                                          | Success or failure                               |

- Color never carries meaning alone. Every status has a word or an accessible name beside it.
- Text tokens meet 4.5:1 and graphics meet 3:1 over every measured backdrop in both modes. A new color is measured before it lands.
- The accent is the only saturated color at rest. Status colors appear only while their status holds.

## Typography

Inter sets the interface and JetBrains Mono sets code and identifiers. Each role is a token with size, weight, and line height.

| Role           | Use it for                                                                                     | Do not use it for                   |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| `type.display` | The one question of the start screen                                                           | More than one element per screen    |
| `type.title`   | Titles of dialogs, sheets, and sections in later surfaces                                      | Pane headers or conversation text   |
| `type.input`   | The instruction input                                                                          | Replies or other inputs             |
| `type.body`    | Conversation text from the person and the agent, replies, and pane header titles at weight 500 | Labels or metadata                  |
| `type.list`    | Rows of the workspace list                                                                     | Conversation text                   |
| `type.note`    | Explanations and inline errors on the start screen; its line height sets the user's bubbles    | Labels or metadata                  |
| `type.meta`    | Activity lines, tool lines, Lervo notices, inline failures, and detail beside a title          | Content the person must read to act |
| `type.caption` | Repository labels, hints, shortcut labels, and segmented controls                              | Body text                           |
| `type.mono`    | Code, branch names, paths, and identifiers                                                     | Prose                               |

- **Weights.** 400 for text, 500 for the display question and pane titles, and 600 for `type.title` and the Lervo source label. No other weights.
- **Line length.** Conversation text stays within `layout.contentMaxWidth`, about 75 characters at `type.body`.
- **Numerals.** Counts, times, and durations use tabular numerals, so values do not shift as they change.
- **Truncation.** Titles and labels truncate at the end with an ellipsis. Paths and identifiers truncate in the middle. Text from the person or the agent never truncates.
- **Other scripts.** Text in other scripts falls back to the platform's fonts, as the visual language lists. Line heights hold for them.
- **Markdown.** Agent messages and questions render Markdown (S1.6c): headings in `type.body` at `font.weight.semibold` for the first level and `font.weight.medium` below, code blocks in `type.mono` and inline code in the mono face at `type.meta` on `color.surface.code`, quotes in `color.text.secondary` behind a `border.width.strong` bar, and tables at `type.meta`. It adds no sizes of its own. Raw HTML shows as text, and links show in `color.text.link` without navigating the window. The person's own messages stay as they typed them.

## Space and layout

| Step                  | Use it for                                                          |
| --------------------- | ------------------------------------------------------------------- |
| `space.2`–`space.6`   | Inside controls: between an icon and its label, segment padding     |
| `space.8`–`space.16`  | Between related elements: rows, a label and its field, card padding |
| `space.20`–`space.32` | Between groups and sections, and side margins of the content column |
| `space.48`            | Screen margins and the start screen's breathing room                |

- **Columns.** The workspace list is `layout.sidebarWidth`; the content column is at most `layout.contentMaxWidth` and keeps `space.32` from the window's edges.
- **Header.** Every pane header is `layout.headerHeight`, and the macOS window controls sit in the sidebar's header strip.
- **Narrow windows.** Below the 760 px breakpoint, which a zoomed window reaches, the workspace list narrows to `layout.sidebarMinWidth` instead of hiding, so navigation never disappears.
- **Density.** One density. List rows use `space.8` vertical padding and sit 1 px apart.
- **Layers.** From back to front: the window, the sidebar and the content, the dock of floating controls, overlays (menus and the command palette), and notices. Each layer gets a stacking token when a second overlay arrives.

## Shape

- **Radii.** `radius.sm` for rows and chips, `radius.md` for buttons, `radius.lg` for messages and the window, `radius.xl` for input cards, and `radius.full` for dots and pills.
- **Concentric corners.** A rounded element inside another has the outer radius minus the padding between them, such as a segment inside its group.
- **Lines.** Hairlines are 1 px in a border color token. Focus rings (`focus.ring.width`) and the question bar (`border.width.strong`) are 2 px.
- **Focus rings.** A free-standing control draws its ring outside, at `focus.ring.offset`. A row, a segment, or a scrolling region draws it inside, at `focus.ring.inset`, so its container never clips it and it never overlaps a neighbor.

## Elevation and material

| Layer        | Material                                       | Shadow            |
| ------------ | ---------------------------------------------- | ----------------- |
| Window       | The platform's material under `glass.tint`     | `shadow.window`   |
| Sidebar      | `color.surface.sidebar` over the window        | none              |
| Content      | `color.surface.workspace`                      | none              |
| Floating     | `color.surface.floating` with the overlay blur | `shadow.raised`   |
| Selected row | `color.surface.selected`                       | `shadow.selected` |

- A CSS `backdrop-filter` appears only on floating controls and overlays over app content.
- Reduced transparency replaces every glass layer with `color.surface.opaque`.
- Dark mode separates layers with borders, not shadows.

## Motion

The [motion principles](ade-motion.md) are this chapter. In short, motion explains a change and never decorates. Only what changes moves, for at most 200 ms, with opacity and transform. Reduced motion stops it.

## Iconography

- Icons are drawn on a 24 px grid with 2 px round-capped strokes, in the current text color.
- Sizes follow their context: 12 px beside caption text, 14 px in list rows, and 16 px in buttons.
- An icon-only control has an accessible name. An icon that is not universally understood also has a visible label.
- The interface uses no emoji.

## Brand

- The stepped-bar logo and its rules are in the visual language. The launch view is the only place the interface shows the mark on its own.
- The product's name is "Lervo" in text, without "the" and without a suffix. The app's name is "Lervo".
- A wordmark for the site follows the logo's geometry. It is defined before the site uses it.

## Imagery

The app uses no illustration or photography of its own; it shows the images a person sends, as they are. Empty states use text and, at most, one icon. The site's imagery is defined with the site and follows the same calm.

## Data display

- **Numbers** use `Intl.NumberFormat` and tabular numerals.
- **Times** are relative within a day, through `Intl.RelativeTimeFormat`, with the absolute time as the accessible description; older times are absolute.
- **Durations** use the largest two units, such as "2 min 30 s".
- **Paths and identifiers** use `type.mono` and truncate in the middle.
- **Diffs and code** use `type.mono` and `color.diff.*`.
- **Charts** for evidence and telemetry use a tokenized categorical palette, defined with the first chart, and label their units.

## Patterns and content

The [craft rules](ade-craft.md) turn the finish the owner expects into rules a change meets or fails: glass for floating surfaces, fill and light instead of drawn lines, one size per group of controls, named actions, locations shown by folder name, menus hung from their control, centered dialogs, nothing that moves into place, overlays whose motion stays visible, and verification in the real app, frame by frame. Every change to the interface is checked against them.

The [patterns and content chapter](ade-design-patterns.md) defines the recurring situations and the writing:

- **Patterns:** status, failures, waiting, navigation and selection, keyboard, input, and notifications.
- **Content:** voice and tone, the glossary the interface and the documentation share, copy rules, localization, and accessible names.

Status words are "Working", "Needs you", and "Done".

## Components

Each component is specified by its purpose, when to use and not to use it, anatomy, variants, sizes, states, keyboard and screen-reader behavior, motion, content rules, the tokens it reads, and examples. Shared components live in `apps/ade/src/ui/` and know nothing about Lervo concepts; features compose them and add only placement. The [design system plan](../../../roadmap/ade/design-system.md) lists the inventory and the order.

- **The catalog.** `apps/ade/catalog/` renders the foundations from the generated tokens and every shared component in every variant and state, in both modes, with its purpose and when to use it and when not. `pnpm --filter @lervo/ade catalog` serves it. It is outside the app's bundle, it is the owner's review surface, and the site will reuse its entries as live examples.
- **Coverage.** A test fails when a module in `src/ui/` has no catalog entry, when an entry lacks its use or its limits, or when a variant does not render.
- **The base.** `src/ui/base.css` holds the tokens and the default text, so the app and the catalog start from the same styles.

| Component          | Use it for                                                                                                                                                                         | Not for                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `InputCard`        | A text field and its actions: the instruction (input, stacked) or a reply (floating, inline)                                                                                       | Short single values, or forms with several fields                                                                                      |
| `AttachmentTray`   | What waits in an input card to go with its text: image thumbnails, then file chips of the same height, above the field                                                             | Images and files already sent, which show in their message                                                                             |
| `FileChip`         | A file attached by path: its type, name, and folder; it shows the file in Finder                                                                                                   | Images, which show as themselves, or links and commands                                                                                |
| `ImageViewer`      | One image at full size over the dimmed window, opened from a message or a tray                                                                                                     | Content other than images, or choices the person must make                                                                             |
| `ListRow`          | A row of a navigation list, such as a workspace                                                                                                                                    | Actions that change data, or rows that need two lines                                                                                  |
| `FloatingButton`   | A way back to where content continues, such as "Jump to latest"                                                                                                                    | Primary actions, or anything that must stay on screen                                                                                  |
| `IconButton`       | The one primary action of an input card, such as send                                                                                                                              | A second primary action, or an action that needs words                                                                                 |
| `Button`           | A secondary action in a bar: a quiet icon with a name, such as removing the workspace, or a question's answers, the action outlined                                                | An input card's primary action, or the failure color for deleting                                                                      |
| `Select`           | A short choice inside a card's action bar; an option that cannot be chosen now stays visible, disabled, with the reason in its text                                                | A form field that needs a visible label                                                                                                |
| `SegmentedControl` | Switching how one object is shown                                                                                                                                                  | Navigation between objects, or more than three options                                                                                 |
| `Kbd`              | The shortcut of the action beside it                                                                                                                                               | Prose about shortcuts                                                                                                                  |
| `InlineAlert`      | A failure where it happened, with its code                                                                                                                                         | Warnings without action, or success                                                                                                    |
| `StatusDot`        | Working and needs-you, with an accessible name                                                                                                                                     | Decoration, or finished work                                                                                                           |
| `WorkingLine`      | What the open conversation's agent is doing now, or the core creating its workspace                                                                                                | Workspaces that are not open, known progress, or a person's action                                                                     |
| `Presence`         | Anything a view shows only sometimes: it fades in and out, and the lint rule requires it or a named motion pattern                                                                 | Whole views, or rows that leave a list                                                                                                 |
| `ViewPresence`     | The main area's change of views, between the start screen and a workspace and between workspaces: the old view fades out as a still copy and the new view fades in halfway through | A change within one view, which uses `Presence`, or content whose leaving copy must stay interactive, because the copy takes no clicks |
| `Waiting`          | Every other wait, where it happens: a person's action in place of its control, a view opening, or reaching the session host                                                        | An agent's work, paging, or text with an ellipsis or "Loading"                                                                         |
| `PaneHeader`       | The main area's title bar                                                                                                                                                          | Section titles inside a pane                                                                                                           |
| Icons              | Size `sm` beside captions, `md` in rows, `lg` in buttons                                                                                                                           | Emoji, or an icon-only control without a name                                                                                          |

## Accessibility

- WCAG 2.2 AA: contrast of 4.5:1 for text and 3:1 for graphics and focus indicators.
- Every control is reachable and operable by keyboard, and focus is always visible.
- Targets are at least 24 × 24 px.
- Roles, names, and live regions describe the interface to screen readers.
- Reduced motion, reduced transparency, increased contrast, and text scaling are honored. `⌘+` and `⌘−` zoom the window, and every layout holds at 200% of the smallest window.

### The 2026-11-23 pass

Design system step 4 checked the start screen, a conversation, and the catalog in headless WebKit:

- **Automated.** axe-core 4 found no WCAG 2.2 A or AA violation on the opaque material in either mode.
- **Contrast.**
  - Rendered pixels on the opaque material gave every text at least 4.5:1 in both modes.
  - Under increased contrast, every text reached 7:1 except a shortcut label at 5.65:1.
  - The native material's ratios come from the real-window measurement in the visual language.
- **Keyboard.** Every control took focus in visual order with a visible ring. Containers draw the ring for their fields.
- **Gaps closed.**
  - Increased contrast had no effect, so the tokens gained `dev.lervo.contrast`.
  - The window could not zoom, so zoom keys were enabled.
  - A zoomed window would hide the workspace list, so the list now narrows instead.
- **Open.** On the native material, the tertiary text on a selected row over a white backdrop in dark mode was not measured on a real window. S1.6b's real-window run measures it.

## Platforms

- macOS shows the native window material and controls. Windows uses Mica or Acrylic. Linux and WSL use the opaque surfaces.
- Shortcuts use each platform's command modifier, and labels come from the catalog.
- Layout, behavior, and contrast are the same on every host.

## Governance

- A new token, component, variant, or pattern starts with its usage in this specification and joins the catalog with a demo before it ships.
- Breaking a token's or component's contract follows a deprecation: the old name stays until no consumer reads it.
- The design system's checks run with `pnpm ade:check`: generated outputs, the motion check, the literal-value check, and the catalog's coverage.
- A pull request that changes `src/ui/`, the tokens, or a screen's layout reruns the accessibility pass and compares the catalog with `main` in headless WebKit, and records both results. The accessibility pass is axe-core, rendered contrast on the opaque material in both modes, a keyboard walk, and the smallest window at 200% zoom. CI takes these checks when one of them misses a regression that reaches `main` ([ADR-0616](../../../decisions/execution/applications/0616-keep-the-design-system-in-the-ade-until-the-site-reads-it.md)).
- **Packaging.** The design system stays in `apps/ade` until the site's first page needs it. That pull request moves the token file and its generators into `@lervo/design-tokens` with an output the site reads. Components move only if the site renders them (ADR-0616).
