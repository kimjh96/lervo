# ADR-0616: Keep the design system in the ADE until the site reads it

Status: `accepted`
Decision date: 2026-11-23
Related: [ADR-0613](0613-host-provider-clis-in-a-first-party-development-environment.md), [ADR-0615](../../release/packaging/0615-version-the-ade-apart-from-the-cli.md)

## Context

The [ADE design system](../../../specifications/execution/product-surfaces/ade-design-system.md) has three parts:

- the DTCG token file and its generators;
- the shared components in `apps/ade/src/ui/`;
- the catalog in `apps/ade/catalog/`.

Documentation and an introduction site are planned, and both are meant to build on the design system. Step 5 of the [design system plan](../../../roadmap/ade/design-system.md) asks whether tokens and components should move into a workspace package that the ADE and the site share.

No site exists yet, and nothing decides its framework, its build, or what it shows. A shared package made now would have one consumer. Its boundary would be guessed: which components a site needs, whether it renders React, and whether it reads CSS custom properties or values.

## Decision

### Stay in the ADE for now

- **No shared package yet.** The token file, the generators, `src/ui/`, and the catalog stay in `apps/ade` until the site's first page needs one of them. The ADE convention's layer rules keep them free of feature knowledge, so moving them later is a move, not a rewrite.
- **The token file stays the one source.** Whatever reads tokens, today or later, reads the DTCG file or an output generated from it, never a copy.

### When the site starts

The pull request that starts the site does these in order:

1. **Tokens first.** The token file and its generators move to a workspace package, `@lervo/design-tokens`.
   - The ADE and the site depend on it.
   - Its generators add an output the site reads, such as resolved values per mode as JSON, beside the CSS the ADE reads.
   - The literal-value check, the motion check, and the generated-output test move with it.
2. **Components only when the site renders them.** `src/ui/` moves to a package only if the site renders the same React components. If the site shows them as live examples, the catalog's entries are the examples. If the site only describes them, the specification is the source, and nothing moves.
3. **Import boundaries follow.** The ESLint layer rules give the new package the place `ui/` and `design/` hold now: it knows no feature, and features know it only through its exports.
4. **Versioning.** A design package is private and versionless, like the other workspace packages. The ADE's version line ([ADR-0615](../../release/packaging/0615-version-the-ade-apart-from-the-cli.md)) and the site's deployment carry its changes.

### Quality gates

- **Running now.** The literal-value check, the motion check, the catalog coverage test, and the generated-output test run with every ADE check.
- **Accessibility checks run locally.** Each change to `src/ui/`, the tokens, or a screen's layout reruns the step 4 accessibility pass in headless WebKit:
  - axe-core for WCAG 2.2 AA;
  - rendered contrast on the opaque material in both modes;
  - a keyboard walk;
  - the smallest window at 200% zoom.

  The pull request records the results. CI does not run them, because a WebKit download on every ADE run costs more Actions time than the owner's budget allows, and the checks rarely change result between design changes.

- **Visual comparisons stay local.** Catalog snapshots in headless WebKit compare a change with `main` before review, as the component steps did, and the pull request records the result.
- **When CI takes them.** If an accessibility or visual regression reaches `main` that the local pass should have caught, the checks join the ADE workflow, filtered to `apps/ade/src/ui/**`, the token file, and the catalog.

## Consequences

- The design system keeps one consumer, and no package boundary is guessed.
- The site's first pull request carries the extraction, so its cost lands with the work that needs it.
- Accessibility and visual regressions depend on the local pass until CI takes them. Each pull request that changes the design records its results, so a skipped pass is visible in review.

## Verification

- `pnpm --filter @lervo/ade check` runs the literal-value, motion, catalog, and generated-output checks.
- Every design pull request records the local accessibility pass and the catalog comparison.
- The site's first pull request moves the token file and its generators into `@lervo/design-tokens`, and the ADE's checks pass against the package.
