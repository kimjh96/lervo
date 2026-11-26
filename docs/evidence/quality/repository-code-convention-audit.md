# Repository code-convention audit

Status: `verified`
Observation date: 2026-08-25

## Scope

This audit evaluated all Lervo production source under `apps`, `packages`, and `scripts` against the active repository code convention. Automated review covered formatting, lint, package direction, strict types, executed tests, generic debt markers, narrow rule suppressions, public entry surfaces, and production modules of at least 400 lines. Tests and fixtures remain subject to lint, types, and their executed suites, but are excluded from the long-production-module registry because their size is commonly declaration- or scenario-shaped.

The long-module review excludes dependencies, generated outputs, coverage, test directories, fixtures, and browser assets. Line count triggers review; it does not establish a defect. Each triggered production module was inspected for its exported surface, owned invariant, external boundary, failure meaning, state lifecycle, and independent reasons to change.

## Remediation

The audit confirmed and corrected these structural violations:

- Repository knowledge lint and query behavior were separated: `lint-query.ts` owns lifecycle lint, `query.ts` owns recommendation behavior, and `repository-publication-files.ts` owns their shared safe-read boundary.
- The repository knowledge CLI was split by OKF exchange, semantic review, semantic materialization, document structure, instruction bridge, migration, formatting, and top-level dispatch. The stable `knowledge-command.ts` path is a short facade and dispatcher.
- Pure knowledge migration rendering and approval parsing were separated from plan/apply mutation.
- The stable terminal command path became a one-line facade over the cohesive terminal-integration runtime.

No generic `manager`, `service`, `helper`, or `utils` dumping module, unbounded `TODO` or `FIXME`, provider-adapter dependency leak, or package-direction violation remained. Three inline `no-unsafe-finally` suppressions remain; each is narrow, adjacent to its fail-closed cleanup or lease-release reason, and required by its failure contract.

ESLint's bulk-suppression file, `eslint-suppressions.json`, holds no entries as of 2026-11-27: every catch clause that throws a new error now passes the caught error as `cause`. Six other inline suppressions remain in production source, each on a single line with its reason beside it. In `packages/context`, two `lervo/require-caught-error-cause` suppressions keep private caller paths and source content out of boundary errors. In `apps/ade`, four suppressions cover React-hook and accessibility rules.

## Continuous gate

`scripts/code-convention-reviews.json` binds every production module of at least 400 lines to its exact SHA-256 content, cohesive responsibility, and reviewed rationale. `pnpm code-convention:check` fails on a missing review, changed content, stale entry, duplicate or unsorted path, malformed rationale, or a module below the review threshold. The registry is not an exception list: confirmed violations must be remediated before the resulting cohesive module is recorded.

At this observation, the gate covered 48 long production modules. The registry is the reviewable source for their individual responsibilities and content hashes.

## Verification

- The complete `pnpm check` chain passed.
- Package production-boundary checks passed for 75 packages.
- Strict TypeScript analysis passed.
- All 320 test files and 1,770 tests passed, including focused repository-knowledge, CLI, terminal-integration, and structural-gate regression suites.
- All 75 buildable workspace packages built successfully.
- CLI release manifest, SBOM, unsigned attestation, built CLI, Hub and Node runtime, standalone distributions, packed consumer, and registry-publication preflight checks passed.
- Documentation lifecycle checks passed for 229 documents, and identity checks passed for 76 packages.

The audit does not claim that line count proves maintainability or that a content hash proves semantic quality. It ensures every current long production module has a reviewed disposition and that later byte changes invalidate that disposition until review is repeated.
