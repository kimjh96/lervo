# Lervo ADE visual language

Status: `proposed`
As of: 2026-11-22

This document defines the design tokens and visual rules of the Lervo ADE that [ADR-0613](../../../decisions/execution/applications/0613-host-provider-clis-in-a-first-party-development-environment.md) proposes. The owner chose the direction from mockups: restrained glass, light and dark modes, essentials only, two status colors, and the stepped-bar logo. This document is the source of truth until S1 creates the token file described at the end; after that, the token file is canonical and this document describes it.

Values here supersede the mockup values where they differ. The mockups used lighter glass than these tokens allow, because the contrast check below requires a stronger tint.

## Glass

- **Native window material.** The window and the workspace list use the platform's own window material: vibrancy on macOS, and Mica or Acrylic on Windows. A CSS `backdrop-filter` inside the webview cannot see the desktop behind the window, so it never produces window glass.
- **Platforms without a material.** Linux and WSL draw the opaque surface tokens. The layout, behavior, and contrast stay the same; only the translucency differs.
- **Tint over the material.** Every surface that carries text adds a tint layer at the `glass.tint.opacity` token or higher. The tint makes text readable over any desktop backdrop (see Contrast evidence).
- **In-app overlays.** A CSS `backdrop-filter` is allowed only for short-lived overlays, such as the command palette and menus, over app content. It never sits over the scrolling conversation or a terminal.
- **Fallbacks.** When the OS asks for reduced transparency or increased contrast, or when the device is in a low-power mode, every glass surface switches to its opaque token.

| Token                | Dark                  | Light                 |
| -------------------- | --------------------- | --------------------- |
| `glass.tint.color`   | `#14161D`             | `#FAFBFD`             |
| `glass.tint.opacity` | `0.88` (minimum)      | `0.88` (minimum)      |
| `glass.overlay.blur` | `28px`, saturate 150% | `30px`, saturate 160% |

## Color

Each token is semantic. Components use tokens, never raw values.

| Token                       | Dark                     | Light                    | Use                                                         |
| --------------------------- | ------------------------ | ------------------------ | ----------------------------------------------------------- |
| `color.surface.opaque`      | `#1A1C23`                | `#F4F5F8`                | The window when glass is off                                |
| `color.surface.sidebar`     | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.35)` | The workspace list over the window surface                  |
| `color.surface.input`       | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.80)` | Instruction and reply inputs                                |
| `color.surface.selected`    | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.85)` | The selected workspace                                      |
| `color.surface.userMessage` | `rgba(255,255,255,0.08)` | `rgba(20,30,50,0.06)`    | The user's messages in the conversation                     |
| `color.surface.terminal`    | `#0F1117`                | `#F7F8FA`                | The CLI conversation                                        |
| `color.border.subtle`       | `rgba(255,255,255,0.06)` | `rgba(20,30,50,0.07)`    | Dividers                                                    |
| `color.border.default`      | `rgba(255,255,255,0.12)` | `rgba(20,30,50,0.10)`    | Inputs and controls                                         |
| `color.border.window`       | `rgba(255,255,255,0.10)` | `rgba(255,255,255,0.75)` | The window edge                                             |
| `color.text.primary`        | `#ECEEF3`                | `#161B26`                | Body text and titles                                        |
| `color.text.secondary`      | `#B4BAC7`                | `#454D5C`                | Supporting text                                             |
| `color.text.tertiary`       | `#9DA4B2`                | `#555D6C`                | Labels, hints, and timestamps                               |
| `color.text.link`           | `#A9C1FF`                | `#2A4DB3`                | Inline actions such as "View diff"                          |
| `color.accent`              | `#7AA2F7`                | `#3A64D8`                | The brand blue: primary buttons, focus, the logo's last bar |
| `color.onAccent`            | `#0B1020`                | `#FFFFFF`                | Text and icons on the accent                                |
| `color.status.working`      | `#7AA2F7`                | `#3A64D8`                | The agent is working                                        |
| `color.status.needsYou`     | `#F2B661`                | `#A86808`                | The workspace needs the user                                |
| `color.status.failed`       | `#F29A8E`                | `#B42318`                | A stage or session failed                                   |
| `color.diff.added`          | `#8FD3B6`                | `#1A7F5A`                | Added lines                                                 |
| `color.diff.removed`        | `#F29A8E`                | `#B42318`                | Removed lines                                               |

Finished work has no status color. A status dot always has a text equivalent for assistive technology.

## Contrast evidence

Ratios use the WCAG 2 relative-luminance formula. Each text token was tested on the glass tint at `0.88` blended linearly in sRGB over five desktop backdrops: white, black, mid gray (`#808080`), saturated yellow (`#FFD666`), and saturated blue (`#285AC8`). The table lists the worst ratio across those backdrops. The blend approximates the native material, so S1 measures the real windows on each platform and records the results.

| Token                              | Dark worst ratio | Light worst ratio | Threshold     |
| ---------------------------------- | ---------------- | ----------------- | ------------- |
| `color.text.primary`               | 11.04            | 12.68             | 4.5 (text)    |
| `color.text.secondary`             | 6.58             | 6.26              | 4.5 (text)    |
| `color.text.tertiary`              | 5.12             | 4.88              | 4.5 (text)    |
| `color.text.link`                  | 7.17             | 5.50              | 4.5 (text)    |
| `color.status.working`             | 5.09             | 3.87              | 3.0 (graphic) |
| `color.status.needsYou`            | 7.10             | 3.32              | 3.0 (graphic) |
| `color.onAccent` on `color.accent` | 7.52             | 5.26              | 4.5 (text)    |

At the mockups' tint opacity of `0.60`, tertiary text fell to 1.61 on a white backdrop in dark mode and to 1.94 on a black backdrop in light mode. That is why the tint minimum is `0.88`.

## Terminal palette

The CLI conversation uses these colors. Every color except dark `black` reaches 4.5 against its terminal background; dark `black` serves as a background color.

| Slot       | Dark      | Light     | Slot           | Dark      | Light     |
| ---------- | --------- | --------- | -------------- | --------- | --------- |
| background | `#0F1117` | `#F7F8FA` | foreground     | `#D8DCE5` | `#1F2533` |
| black      | `#2A2F3A` | `#1F2533` | bright black   | `#7E8696` | `#6A7282` |
| red        | `#F29A8E` | `#B42318` | bright red     | `#F7B3A9` | `#A51F14` |
| green      | `#8FD3B6` | `#1A7F5A` | bright green   | `#A8E0C8` | `#16704F` |
| yellow     | `#F2B661` | `#8A5A00` | bright yellow  | `#F6CD92` | `#7A5000` |
| blue       | `#7AA2F7` | `#2A4DB3` | bright blue    | `#A9C1FF` | `#2443A0` |
| magenta    | `#C3A6F2` | `#7A3FB8` | bright magenta | `#D5C0F7` | `#6B35A3` |
| cyan       | `#7DCFDB` | `#0E7490` | bright cyan    | `#A0DDE6` | `#0B6680` |
| white      | `#C9CED8` | `#5F6777` | bright white   | `#ECEEF3` | `#161B26` |

## Typography

- **Families.** The interface uses Inter. Terminals and code use JetBrains Mono. Both ship under the SIL Open Font License and are subset to the scripts of the shipped catalogs.
- **Other scripts.** Conversation text in other scripts, such as Korean, falls back to the system fonts: Apple SD Gothic Neo on macOS, Malgun Gothic on Windows, and Noto Sans CJK on Linux. The ADE does not bundle CJK fonts, which would exceed the size budget.

| Token          | Size    | Weight | Line height | Use                              |
| -------------- | ------- | ------ | ----------- | -------------------------------- |
| `type.display` | 28 px   | 500    | 1.25        | The start screen question        |
| `type.title`   | 18 px   | 600    | 1.35        | Titles                           |
| `type.input`   | 15 px   | 400    | 1.55        | The instruction input            |
| `type.body`    | 14.5 px | 400    | 1.7         | Conversation text                |
| `type.list`    | 13.5 px | 400    | 1.4         | The workspace list               |
| `type.meta`    | 12.5 px | 400    | 1.4         | Activity lines and Lervo notices |
| `type.caption` | 11.5 px | 400    | 1.4         | Repository labels and hints      |
| `type.mono`    | 13 px   | 400    | 1.75        | The CLI conversation             |

## Space, radius, and layout

- **Space.** The scale uses 2 px steps up to 16 and 4 px steps above: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 48.
- **Radius.** `radius.sm` 8 px for rows, `radius.md` 10 px for buttons, `radius.lg` 14 px for the window and messages, `radius.xl` 16 px for inputs, and `radius.full` for dots.
- **Layout.** The workspace list is 232 px wide. Headers are 48 px tall. The conversation and its input are at most 720 px wide. The window's minimum size is 960 × 600 px. Below 760 px of width, the workspace list collapses into a menu.

## Elevation

| Token           | Dark                           | Light                                                                     |
| --------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `shadow.window` | `0 30px 80px rgba(0,0,0,0.45)` | `0 30px 70px rgba(40,52,80,0.18)`, with a 1 px `rgba(20,30,50,0.06)` ring |
| `shadow.raised` | none; borders separate layers  | `0 8px 24px rgba(40,52,80,0.08)`                                          |

## Motion

[Lervo ADE motion](ade-motion.md) defines the motion principles, the motion tokens, and the catalog of every animated pattern. In short, motion explains a change and never decorates. It moves only opacity and transform, lasts at most 200 ms, and stops entirely when nothing is working or the user prefers reduced motion.

## Icons

Icons are drawn on a 24 px grid with 2 px round-capped strokes and render at 12, 14, or 16 px in the current text color. The interface uses no emoji.

## Logo

- **Geometry.** On a 48-unit grid, three bars of 24 × 9 units with a 4.5-unit corner radius sit at (7, 8), (12, 19.5), and (17, 31).
- **Color.** The first two bars use the text color at 38% and 68% opacity. The last bar uses `color.accent`.
- **Monochrome.** Where a platform requires one color, such as the macOS menu bar, all three bars use that color with the same opacity steps.
- **App icon.** The mark fills 55% of a rounded-square tile with a `#2C3754` to `#151A27` gradient.
- **Clear space and size.** Keep at least one bar height (9 units) clear on every side. The minimum size is 16 px.
- **Misuse.** Do not recolor the first two bars, reorder the opacity steps, rotate the mark, or add glass, blur, or shadow to it.

## Interface copy

- All text comes from the message catalogs. English is the only shipped catalog.
- Copy follows the `writing_en-human` policy. It uses sentence case and concrete verbs.
- Status words are "Working", "Needs you", and "Done".
- Results state what Lervo verified and what it did not, such as "3 checks passed" or "1 file changed, not committed". Copy never celebrates or claims more than the evidence shows.

## Token file

S1 turns these tables into one token file in the W3C Design Tokens Community Group format. A build step generates the CSS custom properties, the terminal theme, and any constants the session host needs. Components and themes read only the generated outputs. When the token file lands, it becomes the source of truth, and this document links to it instead of repeating its values.
