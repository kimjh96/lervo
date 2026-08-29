# ADR-0248: Stage linked-evidence reconciliation activation

Status: `accepted`

## Context

The exact v9 confirmation passed every pre-registered criterion for the unchanged v8 candidate. It improved repeated grounded-answer quality and expected-path recall while reducing observed token and duration totals, and preserved exact selection, loading, final-reference reconciliation, source markers, response structure, and relevant sources. This evidence does not identify the production integration boundary or authorize an extra provider turn, changed context set, or direct-terminal injection.

Operational `lexical-v1` resolves through `SearchIndexPort` and produces recommendation batches. Managed runs apply recommendation policy, load exact bytes, deliver them through a provider-neutral adapter receipt, and capture exact output references. The v9 candidate instead expands ordered lexical recommendations by one Markdown-link hop, asks a provider to select evidence in a separate stage, loads recognized selections only, and reconciles the final exact reference set. This is a post-recommendation context-selection protocol, not a search-engine activation.

Direct terminals have a separate boundary. Their 28 KiB hook bundle records unmanaged `prepared` and exact output `referenced` observations but has no adapter delivery receipt. It cannot claim managed E1-E4 or reproduce the v9 staged protocol under the managed contract.

## Decision

### Preserve the production boundaries

- Keep operational search on `lexical-v1`. Do not create a search-engine selection transition or change search scores, ranks, attempts, recommendation batches, or result-set hashes.
- Place deterministic one-hop projection after validated lexical recommendations and before context selection. Core projection accepts only provider-neutral recommendations and registered-document coordinates. Provider-specific session construction and result parsing remain behind adapters and the orchestrator.
- Exclude direct Codex and Claude terminals. Their selection, 28 KiB assembly, hook preparation, unmanaged reference observation, and finalization remain unchanged. Adoption requires a separate decision defining its byte budget and evidence meanings.
- Preserve the distinction between recommended, selected, loaded, injected, referenced, and used. A linked document remains a shadow candidate until policy selects it; neither a link nor a provider selection response proves relevance or use.

### Authorize only phase A: deterministic local shadow

Phase A may implement `linked-evidence-shadow-v1` for managed runs, reproducing only deterministic v8 link projection against the current registered corpus:

- seed only the three ordered lexical recommendations selected by `top_ranked-v1`;
- resolve repository-relative inline Markdown links in recommendation and link-occurrence order;
- ignore external, absolute, fragment-only, malformed, out-of-corpus, excluded, duplicate, and already recommended targets;
- never recurse;
- retain the deterministic prefix of at most eight linked documents and 65,536 UTF-8 source bytes; and
- bind each retained target to its registered document ID and exact current content hash.

The shadow has no authority. It must not change candidate discovery, E1 selection, E2 loading, E3 injection, E4 reference capture, provider instructions or calls, provider output, write authorization, verification, CLI output, or run success. It adds no provider turn, event type, Hub projection, or network dependency. Failure is isolated from the unchanged managed run and is not a successful fallback.

Use a narrow provider-neutral projection port; do not import CLI, adapter, event-store, or filesystem behavior into search ranking. Repository loading remains a caller-owned safe effect with exact before-and-after hash validation. Because implementation enters the packed CLI dependency closure, completion requires reviewed `patch` release intent; this ADR and roadmap update alone are documentation-exempt.

### Record bounded owner-only shadow observations

Store at most one immutable mode-`0600` record per eligible managed run under deletable `.lervo/state/search/linked-evidence-shadow/`. Readers and writers accept at most 10,000 records, never overwrite one, and stop observing new runs at the limit until ordinary reviewed derived-state policy removes records. Schema v1 requires:

- record, project, run, policy, engine, index, source-snapshot, and nullable engine-selection-transition identifiers;
- source recommendation-batch and result-set hashes;
- recommendation, link-candidate, retained, ignored, and truncated counts;
- retained byte count, projection digest, and ordered opaque retained document IDs with content hashes; and
- status `observed` or `unavailable` with one bounded failure code.

Exclude queries, terms, prompts, source and result bodies, paths, link text, titles, labels, provider session or turn coordinates, credentials, absolute paths, and unrestricted errors. Records are local observations, not canonical execution evidence; they do not sync to Hub or automatically create search assessments.

| Code | Meaning |
| --- | --- |
| `shadow_contract_invalid` | Policy, ordering, identity, count, digest, or schema coordinates are invalid. |
| `shadow_source_unavailable` | A registered source or target is missing, unsafe, stale, unreadable, or hash-mismatched during projection. |
| `shadow_bound_invalid` | Configured depth, source-count, byte, corpus, or retention bounds differ from this decision. |
| `shadow_record_limit_exceeded` | The store contains 10,000 validated observations, so the current run receives none. |
| `shadow_storage_failed` | Persistence or exact read-back validation failed. |

Ignored ineligible links and deterministic prefix truncation are successful bounded outcomes. An unavailable observation never upgrades recommendation or context evidence and never blocks or changes the independently valid managed run.

### Require separate reviews for provider shadow and canary effect

Before any extra provider call, a new reviewed decision must bind the selection protocol and digest, adapter request and receipt, cost and cancellation policy, provider-result privacy, failure handling, sample size, quality ground truth, and release impact. It must leave the primary run result and context unchanged.

Before linked candidates affect E1 selection or later context stages, another reviewed canary decision must bind the exact eligible population, operator authority, maximum exposure, success and stop thresholds, source-byte budget, selected-loaded-injected-referenced telemetry, and user-visible failure behavior. Existing E1-E4 events remain authoritative; any new state or event requires defined fields, privacy handling, and failure meaning.

Advancement from phase A requires one immutable observation set containing at least 30 eligible managed runs and 10 nonempty linked-candidate projections, zero contract, source, bound, storage, or privacy failures, exact replay equality for every retained projection, and explicit review of every truncation. These gates establish projection safety and incidence only, not answer quality or authority for a provider turn.

### Roll back at the owning layer

Phase A rollback disables the shadow policy and stops new derived records. It does not write a search-engine rollback transition because ranking never changed. Existing records may be retained for bounded review or removed under ordinary derived-state policy.

A provider-shadow rollback removes only the extra shadow turn. A canary rollback restores the exact previous context-selection policy before the next run and leaves `lexical-v1` unchanged. Stale, missing, conflicting, or unverifiable rollout state prevents the affected phase rather than silently selecting linked evidence.

## Consequences

V9 now has a production-shaped path without overstating activation. Phase A can measure deterministic linked-evidence incidence and bounds in managed runs while provider-facing and user-visible behavior remains unchanged.

This decision does not authorize provider selection, context expansion, direct-terminal changes, automatic search assessment, Hub synchronization, or canary traffic. Production answer quality remains represented by v9 evaluation evidence until separately reviewed provider-shadow and canary observations exist.

## Verification

- Prove exact parity with the checked-in v8 resolver for valid, invalid, duplicate, excluded, truncated, byte-boundary, and non-recursive cases.
- Prove operational search responses, attempts, recommendation batches, context evidence, provider calls, results, writes, and CLI output are byte-for-byte unchanged with shadow enabled or disabled.
- Prove safe exact-hash loading, deterministic replay, owner-only storage, privacy rejection, bounded retention, storage-failure isolation, and deletion as derived state.
- Run provider adapter common-contract tests to prevent projection behavior leaking into adapters.
- Run structural review, focused tests, `pnpm quality:check`, the complete repository check, knowledge migration and lint, and task-base release completion with reviewed `patch` intent for implementation.

## References

- [ADR-0247: Confirm linked-evidence reconciliation v9](0247-confirm-linked-evidence-reconciliation-v9.md)
- [ADR-0061: Fail-closed operational search-engine resolution](0061-fail-closed-operational-search-engine-resolution.md)
- [ADR-0054: Boundary between search recommendations and managed context selection](0054-search-recommendation-managed-context-boundary.md)
- [ADR-0198: Managed context grounding and coverage](../execution/providers/0198-managed-context-grounding-and-coverage.md)
- [ADR-0197: Unmanaged terminal context observation](../execution/providers/0197-unmanaged-terminal-context-observation.md)
- [CLI version and release management](../../distribution/cli-version-management.md)
