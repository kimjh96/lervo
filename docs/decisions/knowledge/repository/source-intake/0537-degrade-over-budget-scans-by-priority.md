# ADR-0537: Degrade over-budget repository scans by priority

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0457](../../documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) (per-file degradation)

## Context

AGENTS.md tells every agent to run `lervo knowledge query "<purpose and paths>"` before changing repository bytes, so the query is the main way agents find rules and canon.

On 2026-10-31, in `axli`, every query failed with `knowledge_source_limit_exceeded`: "Read source bytes exceed the policy limit."

- `axli`'s policy sets `maxTotalBytes: 33554432` (32 MiB), half the default.
- The repository, after policy exclusions, holds about 59 MB of text sources. For example, `docs/research` holds 25 MB in 272 files.
- `packages/repository-knowledge/src/scanner.ts` throws as soon as the running total of included bytes passes the limit. Nothing is found, and nothing tells the owner why.

ADR-0457 already decided that one oversized file is skipped while intake continues. The total budget kept the older fail-whole behavior. The same failure stops other users of the scanner, such as convergence source capture, as `knowledge_source_limit_exceeded`.

## Decision

### Spend the budget by priority

When the scanner's total byte budget cannot hold every included source, the scan does not fail. It first lists every candidate with its size, then reads content in this priority order until the budget is spent:

1. Agent instructions and provider surfaces, such as `AGENTS.md`, `CLAUDE.md`, and instruction files.
2. Portable skills (`.agents/skills`).
3. Canonical documents under the layout's documentation trees (decisions, specifications, architecture, product, roadmap), and the publication indexes.
4. Source code and configuration.
5. Research, evidence, archives, and other documents.

Within one class, budget admission uses code-point path order, independent of host locale. Result sources, source units, and snapshot identifiers retain the existing scanner order for compatibility. Admission order does not redefine digest order.

Each source that does not fit is recorded with `status: "unsupported"` and `reason: "total_budget_exceeded"`, keeping its path and size. The scan result reports `coverage: "partial"`, with the skipped count and bytes.

`maxFiles` and per-file limits keep their behavior. A file over `maxFileBytes` is still skipped alone. Extension-certain binaries outside portable skill resources are classified as unsupported before budget admission. Opaque skill resources still consume budget. Layout routes share canonical-path recognition with layout validation; declared publication indexes outrank the research tree.

### Readers say what they could not see

- `lervo knowledge query` returns its hits with the partial coverage, and names the skipped classes in its output. An agent then knows that some research documents were not searched.
- Paths that read for an answer (query, prompt context, review context) accept partial coverage.
- Paths that claim currency must not claim it from a partial scan. Convergence, canonicalization, lifecycle verification, and migration completeness record `knowledge_source_limit_exceeded` as their own stop, with the skipped classes as private evidence, and never mark a baseline current.
- Lint reports coverage separately from `valid`. Baseline promotion and verification receipts require complete coverage. Partial staleness observations cannot replace complete projections or be reused as current. Unobserved impact evidence is `unknown` with `scan_incomplete`; partial impact reports and refresh candidates retain coverage and cannot prove deletion or overall currency. A content snapshot identifier alone never proves complete coverage.
- The core health projection (ADR-0535 (core health projection, open in PR #166)) shows partial coverage as a Find gap with the actor `repository scanner`.

### The budget is policy, not a silent cliff

The default budget does not change. A repository may raise `maxTotalBytes` in its policy. Lervo never raises it automatically, because the budget bounds memory and time on every host.

## State, events, privacy, and failure meaning

- Scan results gain `coverage: "complete" | "partial"`, `skippedForBudget: { count, bytes, classes }`, and per-source `reason: "total_budget_exceeded"`. No event type is added. Skipped sources keep path and size, and never content.
- `knowledge_source_limit_exceeded` keeps its meaning for currency-claiming paths. Read-only paths stop using it.

## Verification

Focused tests must show:

- An over-budget scan completes. Higher-priority classes are read first, and the order is deterministic.
- Skipped sources carry `total_budget_exceeded` with path and size, and the result reports partial coverage.
- `lervo knowledge query` returns hits from a partial scan and reports its coverage.
- Convergence and lifecycle verification refuse to claim currency from a partial scan.
- Per-file and `maxFiles` behavior is unchanged.
- Partial-to-complete warm-cache transitions restore complete coverage. Partial staleness observations preserve complete recorded state.
- Metadata-only budget skips remain partial even when their content digest equals a complete scan. Public normalization and pattern promotion refuse them.
- A virtual transform and a real rescan produce the same digest. Registered publications skipped for budget are never reread.
- Custom canonical routes and publication indexes under research retain canonical priority. Excluded binaries do not cause partial coverage.

Installed verification must show `lervo knowledge query` working in `axli`.
