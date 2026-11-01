# ADR-0552: Check changes against the canon that names them

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) (miss rate)
Related: [ADR-0541](0541-bind-agent-queries-to-the-turn-and-observe-path-references.md) (turn selection), [ADR-0551](../../knowledge/documents/links/0551-measure-the-document-link-web-deterministically.md) (link web)

## Context

The Do felt outcome says a result that conflicts with canon is flagged with the conflicting source. [ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) defines the miss rate: turns whose change touched an unselected canonical document. Neither existed.

At Stop, Lervo already knows the turn's changed paths and the documents the turn selected or loaded. It did not know which canonical documents govern a changed path. Compact turns rarely select anything (ADR-0550), so an agent could change a file that a decision names without reading that decision.

## Decision

### The governing index

A canonical document governs the code and configuration paths it names. The index maps each strongly referenced path to current canonical and instruction documents: Markdown links, fenced file names, and inline code paths with an extension or a trailing slash. Weak references, Markdown targets, historical documents, and roadmaps are left out. Roadmaps name code paths as delivery evidence, not as rules over them. A changed path is governed by documents naming it or any directory above it.

The link-web rebuild ([ADR-0551](../../knowledge/documents/links/0551-measure-the-document-link-web-deterministically.md)) writes the index from the same documents to `.lervo/state/governing-index.json`. On the Mac checkout of `lervo` this adds about 0.05 seconds.

### Stop records misses; the next turn checks them

At Stop, a governing document that the turn neither selected, loaded, nor edited is a miss. The hook records one entry per repository-changing turn and keeps the newest turn's misses as pending. The next owner turn shows one optional line naming up to three changed paths and five governing documents, asking the agent to verify the change against them. The line yields to owner rules like other optional lines. It is marked shown only after the hook prepares a turn that contains it.

Stop is not blocked. A block costs another provider turn on every governed change. A path mention is a weak signal. The check is deterministic and explainable: it names the exact sources and the reason, "the canon that names it". Whether the change conflicts is judged by the agent that reads those sources.

### Health reports the miss rate

The Find value gains `governedTurnCount` and `missedTurnCount` over seven days. The Find gap line shows "N/M changing turns missed governing canon".

## State, events, privacy, and failure meaning

- `.lervo/state/governing-index.json`: `schemaVersion: 1`, `documents`, and `entries` (path → document indexes, at most 16 per path).
- `.lervo/state/turn-governance.json`: `schemaVersion: 1`, `turns` (at most 500 from the last seven days, each `at`, `changedCount`, `governingCount`, `missedCount`), and `pending` (`at`, `changed`, `missed`, `shownAt`) or null.
- Both files are private, mode `0600`, and deletable. They hold repository paths and counts, never content, prompts, or replies. No event is added.
- Without an index nothing is recorded, so a missing index never reads as zero misses. A failed write loses one observation and never blocks Stop or a prompt.

## Verification

- `apps/cli/test/turn-governance.test.ts` covers file and directory governance, historical and non-canonical exclusion, recording without an index, misses, consulted documents, shown marking, and the seven-day summary.
- `apps/cli/test/repository-health-projection.test.ts` covers the miss-rate wording.
- On the Mac checkout of `lervo`, a simulated turn changing `apps/cli/src/upgrade-apply.ts`, `apps/cli/src/upgrade-stage-policy.ts`, and `packages/documents/src/document-layout.ts` named the decisions that cite those files.
