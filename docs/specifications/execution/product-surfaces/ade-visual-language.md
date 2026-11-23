# Lervo ADE visual language

Status: `proposed`
As of: 2026-11-23

The [design system](ade-design-system.md) is the entry to the ADE's design language, foundations, and usage rules; this document is its chapter on glass, color, type, space, elevation, icons, the logo, and copy. This document defines the design tokens and visual rules of the Lervo ADE that [ADR-0613](../../../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md) proposes. The owner chose the direction from mockups: restrained glass, light and dark modes, essentials only, two status colors, and the stepped-bar logo. Since S1.5a the token file described at the end is canonical, and this document describes it.

Values here supersede the mockup values where they differ. The glass follows the mockups: the window shows the desktop through the native material and a tint at the mockups' opacity, as measured on the real window below.

## Glass

- **Native window material.** The window uses the platform's own window material: `fullScreenUI` vibrancy on macOS, and Mica or Acrylic on Windows. A CSS `backdrop-filter` inside the webview cannot see the desktop behind the window, so it never produces window glass. On 2026-11-23 the macOS `sidebar` material, which S1.5a used, showed almost no desktop color under any tint; `fullScreenUI` came closest to the approved mockups over their own backdrop.
- **The material stays on.** The window keeps its material when it is not the active window, so the glass does not turn into a flat panel when the user works in another app.
- **One tint for the window.** The whole window carries the `glass.tint` layer over the material, as in the mockups. The document draws it, so the launch view and the frame sit on the same surface. The workspace list and the selected workspace add their lighter surfaces on top.
- **The shell names the material.** Before the page's first paint, the shell sets `data-material` on the document: `native` on macOS, where it draws the material, and `opaque` elsewhere. The first frame therefore already shows the right surface.
- **Platforms without a material.** Linux and WSL draw the opaque surface tokens. The layout, behavior, and contrast stay the same; only the translucency differs.
- **Floating controls.** The reply card and "Jump to latest" float over the conversation on `color.surface.floating` with the overlay blur, and the conversation runs beneath them to the bottom of the window, where it fades out. The owner asked for this on 2026-11-23, because a reply card that kept its own band looked rigid. S1.6b measures scrolling with them.
- **In-app overlays.** Short-lived overlays, such as the command palette and menus, may use the same CSS `backdrop-filter` over app content.
- **Fallbacks.** When the OS asks for reduced transparency or increased contrast, or when the device is in a low-power mode, every glass surface switches to its opaque token.

| Token                | Dark                  | Light                 |
| -------------------- | --------------------- | --------------------- |
| `glass.tint.color`   | `#14161D`             | `#FAFBFD`             |
| `glass.tint.opacity` | `0.75`                | `0.60`                |
| `glass.overlay.blur` | `28px`, saturate 150% | `30px`, saturate 160% |

## Color

Each token is semantic. Components use tokens, never raw values.

| Token                       | Dark                     | Light                    | Use                                                         |
| --------------------------- | ------------------------ | ------------------------ | ----------------------------------------------------------- |
| `color.surface.opaque`      | `#1A1C23`                | `#F4F5F8`                | The window when glass is off                                |
| `color.surface.sidebar`     | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.35)` | The workspace list over the window surface                  |
| `color.surface.input`       | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.80)` | Instruction and reply inputs                                |
| `color.surface.floating`    | `rgba(30,32,40,0.62)`    | `rgba(255,255,255,0.62)` | The reply card and controls over the conversation           |
| `color.surface.selected`    | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.85)` | The selected workspace                                      |
| `color.surface.workspace`   | `rgba(255,255,255,0)`    | `rgba(255,255,255,0.35)` | The selected workspace's conversation over the window glass |
| `color.surface.code`        | `rgba(255,255,255,0.06)` | `rgba(20,30,50,0.05)`    | Code blocks and inline code in agent messages               |
| `color.surface.userMessage` | `rgba(255,255,255,0.08)` | `rgba(20,30,50,0.06)`    | The user's messages in the conversation                     |
| `color.border.subtle`       | `rgba(255,255,255,0.06)` | `rgba(20,30,50,0.07)`    | Dividers                                                    |
| `color.border.default`      | `rgba(255,255,255,0.12)` | `rgba(20,30,50,0.10)`    | Inputs and controls                                         |
| `color.border.window`       | `rgba(255,255,255,0.10)` | `rgba(255,255,255,0.75)` | The window edge                                             |
| `color.text.primary`        | `#ECEEF3`                | `#161B26`                | Body text and titles                                        |
| `color.text.secondary`      | `#B4BAC7`                | `#454D5C`                | Supporting text                                             |
| `color.text.tertiary`       | `#A3AAB7`                | `#4C5361`                | Labels, hints, and timestamps                               |
| `color.text.link`           | `#A9C1FF`                | `#2848AA`                | Inline actions such as "View diff"                          |
| `color.accent`              | `#7AA2F7`                | `#3A64D8`                | The brand blue: primary buttons, focus, the logo's last bar |
| `color.onAccent`            | `#0B1020`                | `#FFFFFF`                | Text and icons on the accent                                |
| `color.status.working`      | `#7AA2F7`                | `#3A64D8`                | The agent is working                                        |
| `color.status.needsYou`     | `#F2B661`                | `#975C06`                | The workspace needs the user                                |
| `color.status.failed`       | `#F29A8E`                | `#B42318`                | A stage or session failed                                   |
| `color.diff.added`          | `#8FD3B6`                | `#1A7F5A`                | Added lines                                                 |
| `color.diff.removed`        | `#F29A8E`                | `#B42318`                | Removed lines                                               |

Finished work has no status color. A status dot always has a text equivalent for assistive technology.

## Contrast evidence

Ratios use the WCAG 2 relative-luminance formula. On 2026-11-23 the shell ran on the owner's Mac in each mode over five full-screen backdrops behind the window: white, black, mid gray (`#808080`), saturated yellow (`#FFD666`), and saturated blue (`#285AC8`). Screen captures of the window gave the background behind the workspace list, the start screen, and the terminal, and each text token was compared with the worst of them. Text pixels are the opaque token colors, so the ratio is exact for each sampled background.

| Token                              | Dark worst ratio | Light worst ratio | Threshold     |
| ---------------------------------- | ---------------- | ----------------- | ------------- |
| `color.text.primary`               | 9.48             | 10.18             | 4.5 (text)    |
| `color.text.secondary`             | 5.65             | 5.03              | 4.5 (text)    |
| `color.text.tertiary`              | 4.71             | 4.57              | 4.5 (text)    |
| `color.text.link`                  | 6.16             | 4.78              | 4.5 (text)    |
| `color.status.working`             | 4.37             | 3.11              | 3.0 (graphic) |
| `color.status.needsYou`            | 6.10             | 3.22              | 3.0 (graphic) |
| `color.onAccent` on `color.accent` | 7.52             | 5.26              | 4.5 (text)    |

The worst backgrounds are the black backdrop in light mode and the white backdrop in dark mode. Three light colors and the dark tertiary text are slightly darker or lighter than S1.5a's values so that they pass there; the dark tint is stronger than the light one for the same reason. S1.5a's tint of `0.88` had passed a blended estimate but hid the glass that the owner approved.

## Typography

- **Families.** The interface uses Inter. Code uses JetBrains Mono. Both ship under the SIL Open Font License and are subset to the scripts of the shipped catalogs.
- **Other scripts.** Conversation text in other scripts, such as Korean, falls back to the system fonts: Apple SD Gothic Neo on macOS, Malgun Gothic on Windows, and Noto Sans CJK on Linux. The ADE does not bundle CJK fonts, which would exceed the size budget.

| Token          | Size    | Weight | Line height | Use                              |
| -------------- | ------- | ------ | ----------- | -------------------------------- |
| `type.display` | 28 px   | 500    | 1.25        | The start screen question        |
| `type.title`   | 18 px   | 600    | 1.35        | Titles                           |
| `type.input`   | 15 px   | 400    | 1.55        | The instruction input            |
| `type.body`    | 14.5 px | 400    | 1.7         | Conversation text                |
| `type.list`    | 13.5 px | 400    | 1.4         | The workspace list               |
| `type.note`    | 13 px   | 400    | 1.6         | Explanations and inline errors   |
| `type.meta`    | 12.5 px | 400    | 1.4         | Activity lines and Lervo notices |
| `type.caption` | 11.5 px | 400    | 1.4         | Repository labels and hints      |
| `type.mono`    | 13 px   | 400    | 1.75        | Code and identifiers             |

## Space, radius, and layout

- **Space.** The scale uses 2 px steps up to 16 and 4 px steps above: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 48.
- **Radius.** `radius.sm` 8 px for rows, `radius.md` 10 px for buttons, `radius.lg` 14 px for the window and messages, `radius.xl` 16 px for inputs, and `radius.full` for dots.
- **Layout.** The workspace list is 232 px wide. Headers are 48 px tall. The conversation and its input are at most 720 px wide. The window's minimum size is 960 × 600 px. Below 760 px of width, which a zoomed window reaches, the workspace list narrows to 160 px (`layout.sidebarMinWidth`) and stays.

## Sizes, states, and focus

| Token                                         | Value           | Use                                                                                           |
| --------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `size.control.sm` / `md` / `lg`               | 24 / 28 / 34 px | Segments, chips, and icon buttons in input cards                                              |
| `size.dot.default` / `attention`              | 6 / 7 px        | Status and working dots; the needs-you dot                                                    |
| `size.icon.sm` / `md` / `lg`                  | 12 / 14 / 16 px | Icons beside captions, in rows, and in buttons                                                |
| `size.logo.launch`                            | 96 px           | The mark in the launch view, two pixels per grid unit, so its edges stay sharp at every scale |
| `opacity.disabled`                            | 0.45            | A control that cannot act now                                                                 |
| `focus.ring.width` / `offset` / `inset`       | 2 / 2 / −2 px   | Focus rings outside a control, or inside a row or segment                                     |
| `border.width.strong`                         | 2 px            | The question bar                                                                              |
| `font.weight.regular` / `medium` / `semibold` | 400 / 500 / 600 | The only weights                                                                              |
| `layout.startMaxWidth`                        | 640 px          | The start screen column                                                                       |
| `layout.bubbleMaxWidth`                       | 80%             | The user's message bubbles                                                                    |

The palette (`palette.*`) holds the solid colors that the semantic color tokens alias. It is a primitive tier: components never read it, and the stylesheet does not expose it.

## Elevation

| Token           | Dark                           | Light                                                                     |
| --------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `shadow.window` | `0 30px 80px rgba(0,0,0,0.45)` | `0 30px 70px rgba(40,52,80,0.18)`, with a 1 px `rgba(20,30,50,0.06)` ring |
| `shadow.raised` | none; borders separate layers  | `0 8px 24px rgba(40,52,80,0.08)`                                          |

## Motion

[Lervo ADE motion](ade-motion.md) defines the motion principles, the motion tokens, and the catalog of every animated pattern. In short, motion explains a change and never decorates. It moves only opacity and transform, lasts at most 200 ms, and stops entirely when nothing is working or the user prefers reduced motion.

## Icons

Icons are drawn on a 24 px grid with 2 px round-capped strokes and render at 12, 14, or 16 px in the current text color. The interface uses no emoji.

## Increased contrast

When the platform asks for more contrast, these tokens change, and every other token keeps its value.

| Token                  | Dark                     | Light                   |
| ---------------------- | ------------------------ | ----------------------- |
| `glass.tint.opacity`   | `1`                      | `1`                     |
| `color.text.secondary` | `{palette.neutral.100}`  | `{palette.neutral.925}` |
| `color.text.tertiary`  | `{palette.neutral.300}`  | `{palette.neutral.650}` |
| `color.border.subtle`  | `rgba(255,255,255,0.16)` | `rgba(20,30,50,0.20)`   |
| `color.border.default` | `rgba(255,255,255,0.30)` | `rgba(20,30,50,0.32)`   |

## Logo

- **Geometry.** On a 48-unit grid, three bars of 24 × 9 units with a 4.5-unit corner radius sit at (7, 8), (12, 19.5), and (17, 31).
- **Color.** The first two bars use the text color at 38% and 68% opacity. The last bar uses `color.accent`.
- **Monochrome.** Where a platform requires one color, such as the macOS menu bar, all three bars use that color with the same opacity steps.
- **App icon.** The mark fills 55% of a rounded-square tile with a `#2C3754` to `#151A27` gradient.
- **Clear space and size.** Keep at least one bar height (9 units) clear on every side. The minimum size is 16 px.
- **Launch view.** From the window's first frame until the first screen is ready, the full-color mark shows at `size.logo.launch` in the center of the window's surface. It has no text and no progress indicator. The motion principles' "Launch" pattern times its exit.
- **Misuse.** Do not recolor the first two bars, reorder the opacity steps, rotate the mark, or add glass, blur, or shadow to it.

## Interface copy

- The application is called Lervo wherever a user sees it: the window, the menu bar, the Dock, and notifications. "ADE" names the desktop application only inside the project.
- All text comes from the message catalogs. English is the only shipped catalog.
- Copy follows the `writing_en-human` policy. It uses sentence case and concrete verbs.
- Status words are "Working", "Needs you", and "Done".
- Results state what Lervo verified and what it did not, such as "3 checks passed" or "1 file changed, not committed". Copy never celebrates or claims more than the evidence shows.

## Token file

`apps/ade/src/design/tokens.json` holds these tokens in the W3C Design Tokens Community Group format. `pnpm --filter @lervo/ade generate` writes the CSS custom properties from it, and components and themes read only the generated outputs. When a value here and the token file differ, the token file wins.
