# Lervo ADE design system

Status: `active`
As of: 2026-11-23

## Purpose

On 2026-11-23 the owner asked for a well-built design system. It must keep the ADE consistent and its components reusable and extensible, so that maintenance stays flexible. Documentation and an introduction site are planned, and both build on it. The owner set the scope as everything a design system holds: tokens, typography, and every other design element, with guidance on when and how to use each, and a design language grounded in what Lervo sets out to do. The items the owner named are examples, not the limit.

This plan lists what the system must contain and when it is complete. Its output is the ADE design system specification. The [visual language](../../specifications/execution/product-surfaces/ade-visual-language.md) and the [motion principles](../../specifications/execution/product-surfaces/ade-motion.md) become two of its foundation chapters.

## Design language

The design language comes from Lervo's [purpose](../../product/vision.md): repository work that is durable, inspectable, and portable, done locally, with evidence for what happened. Each principle below states what it means for layout, color, type, copy, and motion. The specification refines the principles with the owner, using demos as the motion principles did.

- **Calm by default.** Nothing moves or calls for attention unless work changes. Restrained glass, two status colors, and still screens keep attention on the work.
- **Evidence before claims.** The interface shows what Lervo verified and what it did not. The evidence states `selected`, `loaded`, `injected`, `referenced`, and `used` stay visually distinct, and missing telemetry reads as unknown, never as zero ([evidence language](../../product/vision/execution/evidence-language.md)).
- **Codes, then words.** A failure shows its stable code with a plain explanation and the next step. The interface never replaces a failure with its own state.
- **The repository is the source.** Lervo-managed and user-owned content look different wherever both appear.
- **Act, then report, with undo.** Consequential effects are reversible and reported after the fact (AGENTS.md invariant 10). The system has an undo-and-notice pattern instead of approval dialogs.
- **Provider neutral.** Capabilities shape the interface; no provider's branding leads it.
- **Local first, ready for more hosts.** A host's identity shows once more than one host takes part.
- **Essentials only.** Each element earns its place; a second way to do the same thing does not ship.

## Foundations

| Foundation             | What the specification defines                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens                 | Tiers from primitives to semantic and component tokens, naming, modes (light, dark, increased contrast, reduced transparency), the DTCG source, and generated outputs for CSS, TypeScript, and the site                           |
| Color                  | Primitive palettes, semantic roles (surfaces, text, borders, accent, status, diff, evidence states), contrast rules with measurements, and the glass material on each platform                                                    |
| Typography             | Families and licenses, the scale, roles and when to use each, weights, line length, tabular numerals, truncation and wrapping, other scripts and their fallbacks, and Markdown typography (headings, lists, code, tables, quotes) |
| Space and layout       | The spacing scale, content widths, columns, breakpoints and collapse, density, window chrome and safe areas, and stacking layers                                                                                                  |
| Shape                  | Radii and the concentric rule for nested corners, borders, strokes, and dividers                                                                                                                                                  |
| Elevation and material | Shadows, glass levels, overlays, and scrims, with opaque fallbacks                                                                                                                                                                |
| Motion                 | The existing motion principles, tokens, and pattern catalog                                                                                                                                                                       |
| Iconography            | The grid, stroke, sizes, the icon inventory, and when an icon needs a visible label                                                                                                                                               |
| Brand                  | The logo, the app icon, the name "Lervo" and its usage, and a wordmark for the site                                                                                                                                               |
| Imagery                | Illustration for empty states and the site, if any, and when imagery is not used                                                                                                                                                  |
| Data display           | Numbers, dates, durations, relative times, file paths, identifiers, diffs, code, and charts for evidence and telemetry                                                                                                            |

## Content

- **Voice and tone**, with examples for success, failure, waiting, and notices.
- **Terminology**: one glossary for workspace, workstream, session, evidence, verification, and the other Lervo concepts the interface shows, shared with the documentation.
- **Status words** and their colors, failure messages (code, explanation, next step), empty and loading copy, notifications, and shortcut labels.
- **Localization**: ICU messages, no concatenation, text expansion, logical properties, and right-to-left readiness.
- **Accessible names** for controls, regions, and live updates.

## Components

Each component has a purpose, when to use it and when not to, anatomy, variants, sizes, states (rest, hover, pressed, focus, disabled, loading, error), keyboard and screen-reader behavior, motion, content rules, the tokens it reads, examples, and dos and don'ts.

- **Existing components**, which move onto the specification:
  - the pane header, status dot, and working line;
  - the conversation list and the reply card;
  - the instruction card and the workspace list rows;
  - the floating "Jump to latest" control.
- **Components features now style on their own**, which become shared:
  - buttons (primary, secondary, quiet, icon) and the segmented control;
  - the select chip, the text input card, and the keyboard shortcut label;
  - the inline notice and the list row.
- **Components the roadmap needs next**:
  - tooltips, menus, and the command palette;
  - disclosure, badges for evidence states, and progress;
  - the undo notice, the diff view, code blocks, and the Markdown renderer (S1.6c);
  - empty states.
- **API rules**:
  - composition over long prop lists, and variants as named values;
  - no feature-specific props, and headless primitives underneath;
  - stable part names, so themes and the site can style a component without forking it.

## Patterns

- **Status**: working, needs you, done, and failed, for workspaces and sessions, never by color alone.
- **Evidence and verification**: states that are never promoted, sources and hashes, and unknown shown as unknown.
- **Failures**: inline or global placement, codes with explanations, and recovery actions.
- **Undo and after-the-fact notices** for consequential effects.
- **Waiting**: launching, empty, loading, streaming, reconnecting, and session host unavailable.
- **Navigation and selection**: the workspace list, the start screen, switching, and what stays still.
- **Keyboard**: a shortcut registry, focus order, and the command palette.
- **Input**: drafts, validation, and sending.
- **Notifications**: desktop or in-app.
- **Later surfaces**: settings, first run, and more than one host.

## Accessibility and platforms

- **Accessibility** targets WCAG 2.2 AA:
  - contrast of 4.5:1 for text and 3:1 for graphics and focus indicators;
  - visible focus, and targets of at least 24 px;
  - complete keyboard operation, with roles and live regions for screen readers;
  - reduced motion, reduced transparency, increased contrast, and text scaling.
- **Platforms**:
  - the native material and window controls on macOS, Mica or Acrylic on Windows, and opaque surfaces on Linux and WSL;
  - native conventions for modifiers, scroll bars, and menus;
  - the same behavior and contrast on every host.

## Governance and tooling

- **One source.**
  - The DTCG token file stays canonical, and the generators add an output the site can read.
  - An ADR decides whether tokens and components move into a workspace package that the ADE and the site share, and updates the import-boundary rules to match.
- **A component catalog** outside the app bundle renders every component and pattern in every variant, state, and mode. It is the review surface for the owner and the source of the site's live examples.
- **Contribution.**
  - A new component, variant, or token starts with its usage reasoning and joins the catalog with a demo before it ships.
  - Deprecation and versioning rules keep the site and the ADE in step.
- **Quality gates.**
  - A stylesheet check, like the motion check, rejects literal colors, sizes, radii, and type in components.
  - Accessibility checks run in headless WebKit.
  - Visual comparisons of the catalog run in headless WebKit locally. CI runs them only when ADE paths change, to keep Actions spend low.
  - A test renders every catalog entry.
- **Naming parity.** Design files, tokens, and code use the same names.

## Order

Each step lands as its own pull request:

1. The design language and the foundations: write them, then audit the current interface against them.
2. Token tiers and the literal-value check.
3. Shared components and the catalog, with features moved onto them.
4. Patterns, content, and the accessibility pass.
5. Governance, the packaging ADR, and the outputs the site needs.

## Audit on 2026-11-23

Step 3 made every repeated control a shared component: the input cards, the icon button, the select chip, the segmented control, the shortcut label, the inline failures, the list rows, and the floating "Jump to latest" control. Features compose them and add only placement. The catalog in `apps/ade/catalog/` shows them with the foundations, and in WebKit the app's screens match step 2 pixel for pixel.

Step 2 resolved every item marked step 2 below: the palette tier and the semantic size, state, focus, weight, and layout tokens exist, every literal value moved to a token, icon sizes are token names, and `scripts/check-literals.mjs` keeps it so. `type.title` stays reserved for dialogs and sections.

Step 1 wrote the design language and the foundations in the [ADE design system specification](../../specifications/execution/product-surfaces/ade-design-system.md) and measured the interface against them. Each divergence names the step that resolves it.

- **Literal values** (step 2):
  - two 34 px send buttons and a 28 px select chip;
  - a 24 px segment height, 6 and 7 px status dots, and a 6 px working dot;
  - a disabled opacity of 0.45 in two places;
  - focus-ring offsets of 2, 1, and −2 px;
  - the start column's 640 px width, the user bubble's 80% width, and the display question's −0.01 em letter spacing;
  - font weights written as numbers;
  - icon sizes passed as numbers.
- **Missing tiers** (step 2): the token file has semantic tokens only. The palette, the size scale, opacity, weights, focus rings, icon sizes, and stacking layers have no tokens yet.
- **Copies instead of components** (step 3):
  - the start screen's submit button and the reply card's send button share one style in two stylesheets;
  - the instruction card and the reply card are two input cards;
  - the mode switch is the only segmented control and styles itself;
  - the workspace list row, the select chip, the shortcut label, and the inline failures of four features have no shared component.
- **Unused or unclear roles** (step 2): `type.title` has no consumer yet. `type.note` also sets the user bubble's line height, which the specification records.
- **Content** (step 4): there is no glossary yet, and empty states have no pattern; the workspace list shows nothing when there are no workspaces.

## Progress

- **Step 4**, on 2026-11-23, did the following:
  - wrote the [patterns and content chapter](../../specifications/execution/product-surfaces/ade-design-patterns.md);
  - checked accessibility in headless WebKit;
  - closed three gaps: increased contrast, window zoom, and a workspace list that hid in narrow windows.

  The evidence and undo patterns wait for the features that need them.

- **Step 5**, on 2026-11-23, did the following:
  - [ADR-0616](../../decisions/execution/applications/0616-keep-the-design-system-in-the-ade-until-the-site-reads-it.md) keeps the design system in the ADE until the site reads it;
  - it names what the site's first pull request extracts: the token file and its generators into `@lervo/design-tokens`, with a site output, and components only if the site renders them;
  - accessibility checks and catalog comparisons run locally on every design change and join CI only after a miss.

  What remains of this plan is the owner's review of the catalog, and the evidence and undo patterns with their features.

## Completion

The design system is complete when:

- the specification covers every section of this plan;
- every ADE screen is composed of catalog components;
- no design value outside the token file appears in a component, and the check enforces it;
- the catalog covers every component and pattern, and its accessibility and visual checks pass;
- the owner has reviewed the catalog.
