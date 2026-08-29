# ADR-0255: Authorize paired Codex-Claude provider-shadow v2

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0254](0254-pre-register-recoverable-provider-shadow-pilot-v2.md) designed a recoverable Codex-only successor after [provider-shadow v1](../../../evidence/search/linked-evidence-provider-shadow-pilot-v1.md) stopped at its identity and persistence boundary. Its provider-free contract and tests were complete, but no v2 preparation or provider call had occurred.

The user then instructed the agent to complete the experiment without another decision, report accuracy, speed, and savings, and measure Claude as well as Codex. Because v2 had produced no effect, its population can expand without mixing or retrying observations.

## Decision

### Replace the unexecuted single-provider contract

Supersede ADR-0254's unexecuted contract with schema-v3 bytes at `benchmarks/search/linked-evidence-provider-shadow-pilot-v2.json`. Bind one paired experiment using the same 24 fresh source samples, candidate envelopes, human-reviewed ground truth, exact selection protocol, limits, recovery semantics, and no-effect boundary.

Run two provider arms against every source sample:

- Codex `gpt-5.6-sol`, with at most 24 invocations.
- Claude `opus`, with at most 24 invocations.

The exact total ceiling is 48 provider invocations. Give both providers the same query and candidate bytes for each source sample. Alternate which provider runs first by source-sample ordinal to bound time-order bias. Use distinct provider-specific shadow-run, local-session, target-turn, provider-session, provider-turn, receipt, attempt, and observation coordinates. Do not reuse a session across providers or samples.

Run Claude through the provider-neutral adapter in read-only mode with plan permissions and only read-only `Read`, `Glob`, and `Grep` tool declarations. The selection protocol prohibits repository inspection; any tool or command completion rejects the sample. Keep provider-native session behavior inside its adapter.

### Preserve v2 recovery and stop behavior

During provider-free preparation, translate registered `sourceId` exactly once into the canonical candidate shape `{ documentId, contentHash, byteCount, classes }`. Delivery, parsing, replay, and review use only that shape.

Before each adapter effect, persist preallocated provider-specific coordinates in the mode-`0600` attempt journal. After every adapter boundary, persist and read back newly available session, receipt, turn, invocation-count, and completion coordinates. Every accepted turn produces one immutable observed or bounded unavailable record before the next call or review.

One process may advance the pre-registered 48-attempt schedule. Any later invocation that finds attempt, execution, failure, observation, recovery, or review state must not resume calls. Provider-free recovery may materialize only a bounded unavailable observation and stop the experiment. There are no retries, replacements, repair turns, answer turns, semantic-publication calls, or provider fallbacks.

Stop both arms on the first failed or unavailable sample. Reject the paired experiment rather than permit an unequal or selectively completed comparison.

### Review each provider independently and compare descriptively

Each provider must independently satisfy the ADR-0254 quality gate over exactly 24 observed samples and 24 invocations: 100% reviewed expected-path recall; at least 65% mean returned-selection precision; at least 50% precision per observation; at most eight selections; complete duration and usage; and zero unavailable, replay, privacy, adapter, result, usage, relevant-source-drop, or primary-effect failures.

Passing requires both providers and all 48 observations to pass. Do not average one provider's failure into the other's success or select a winner using a threshold invented after execution.

Publish a redacted report containing provider-specific and paired aggregates:

- Reviewed recall and precision, selected-source counts, and per-case outcomes.
- Total, mean, median, and p95 duration.
- Observed input, cached-input, output, reasoning-output, and total tokens.
- Candidate-to-selection count and byte compression, described only as potential downstream context savings.
- Absolute and relative differences between providers.

Observed token counts are not billed cost; do not infer currency savings without provider-specific billed-price evidence. Duration is observed wall time, not service-level latency. Candidate compression does not reduce the completed selection turn; it estimates only a later selected-body loading stage.

### Keep production effects unauthorized

The paired experiment changes no operational search selection, primary managed context, output, writes, verification, publication, E1-E4 events, direct terminals, canary traffic, or production behavior. Passing authorizes only a separate canary-design decision.

## Consequences and release impact

The paired executable harness is repository tooling outside the packed CLI dependency closure. Existing CLI and bundled-private behavior remain unchanged. The task-base release-completion check must prove the exemption; do not add unnecessary release intent.

## Verification

- Bind the exact contract digest and current execution-authority workstream before preparation.
- Provider-free, reconstruct 24 source samples and 48 provider attempts with identical paired candidate-envelope and request digests and fresh provider-specific coordinates.
- Run common fake Codex and Claude adapter outcomes through the same turn boundary, including success, pre-acceptance failure, post-acceptance invalid result, usage failure, stop failure, journal failure, unavailable materialization, privacy rejection, and non-resumability.
- Run one exact 48-call schedule, stop on first failure, persist immutable owner-only evidence, and review providers independently before paired comparison.
- Publish only redacted aggregates and run focused, quality, documentation, knowledge, adapter, full-repository, and task-base release checks.

## References

- [ADR-0254: Pre-register a recoverable provider-shadow pilot v2](0254-pre-register-recoverable-provider-shadow-pilot-v2.md)
- [Provider-shadow v1 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v1.md)
- [Phase-A pilot v3 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md)
- [Human-reviewed linked-evidence v8 suite](../../../../benchmarks/search/linked-evidence-reconciliation-v8.json)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
