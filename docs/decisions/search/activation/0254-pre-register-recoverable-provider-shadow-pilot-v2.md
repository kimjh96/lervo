# ADR-0254: Pre-register a recoverable provider-shadow pilot v2

Status: `superseded_before_execution`
Date: 2026-08-28

Superseded by [ADR-0255](0255-authorize-paired-codex-claude-provider-shadow-v2.md) before any v2 provider call.

## Context

[Provider-shadow v1](../../../evidence/search/linked-evidence-provider-shadow-pilot-v1.md) stopped after one provider invocation. Delivery translated registered `sourceId` values to adapter `documentId` values, but the parser inspected the original registered-source objects. It therefore rejected the provider's two exact expected tokens as unknown and threw before persisting a canonical observation. The retained failure state lacks enough local coordinates to reconstruct one.

Bounded post-stop replay showed a plausible signal—100% reviewed recall and precision for ordinal 1—but is not a valid observation. It cannot replace canonical evidence, justify a retry, or authorize context effects.

The user selected a successor design. This decision preserves v1, defines a fresh population, removes the identity mismatch, and makes accepted calls recoverably observable. It authorizes no provider calls, managed-context changes, canary traffic, or production activation.

## Decision

### Pre-register v2 without execution

Adopt `benchmarks/search/linked-evidence-provider-shadow-pilot-v2.json` as the exact design-only contract, without creating a v2 execution entrypoint. Later execution authority must name the checked-in contract digest and its maximum of 24 provider invocations.

Keep v1 stopped and rejected. Never resume it, retry its sample, reuse its provider result, borrow its coordinates, remove its retained state, or count its forensic replay as a v2 observation.

### Create a fresh v2 shadow population

Provider-free, derive 24 fresh v2 sample records from the immutable v3 source population: six human-reviewed lexical-hit cases repeated four times each. Before any provider effect, assign every sample, shadow run, local session, and target turn a new `psv2_` coordinate. No coordinate may come from v1.

Reusing immutable human-reviewed ground truth and source bytes does not resume a provider attempt. Future authorized execution may make only new calls against new v2 sample coordinates. Continue binding the v3 manifest digest, public v8 suite digest, exact v8 selection-protocol digest, maximum of 16 candidates, measured maximum of 130,302 provider-visible source bytes, and independent 262,144-byte hard ceiling.

### Use one candidate identity after preparation

At the provider-free preparation boundary, translate each registered source exactly once into:

```text
{ documentId, contentHash, byteCount, classes }
```

Afterward, prohibit `sourceId`. Candidate scheduling, adapter delivery, result parsing, replay, observation construction, and review must use the same canonical record. Do not add permissive aliases at later boundaries. Identity disagreement must fail during preparation, before any call, rather than create post-call parser ambiguity.

### Persist a durable journal around every adapter boundary

Maintain one owner-only, mode-`0600`, mutable controller journal of kind `linked_evidence_provider_shadow_attempt.v2`. Its monotonic stages are `prepared`, `session_started`, `context_injected`, `turn_accepted`, `turn_completed`, `observation_persisted`, and `stopped`.

Preparation persists shadow-run, local-session, and target-turn coordinates. After every successful adapter boundary, persist and read back each newly available provider-session, adapter-receipt, provider-turn, and invocation-count coordinate before continuing. Provider acceptance of a turn sets its invocation count to one before awaiting completion.

Post-turn handling returns a typed observed-or-unavailable outcome. Parsing, usage, binding, privacy, or storage validation must not throw across post-turn handling before the journal records the completed boundary and observation persistence is attempted.

### Recover observation availability, never execution

Every accepted turn must produce exactly one immutable `linked_evidence_provider_shadow_observation.v2` record before another call or review. A valid result produces `observed`. A rejected or incomplete post-turn result produces `unavailable`, recording the last availability stage, bounded missing-coordinate names, a bounded failure code, the last durable attempt digest, invocation count, and nullable unavailable provider coordinates.

If abrupt termination prevents immediate persistence, a provider-free recovery operation may create only an unavailable record from the journal. Recovery cannot contact the provider, wait for an old turn, parse a retained raw result, resume the schedule, retry, replace a sample, or borrow v1 evidence.

Any v2 attempt, execution, failure, review, observation, or recovery state makes the pilot non-resumable. After required recovery materialization, it may be reviewed as stopped but may never issue another provider call. This prevents uncertain call counts from expanding the budget.

### Retain bounded private state and unchanged effects

Retain no more than two provider-shadow pilots under `.lervo/state/search/linked-evidence-provider-shadow-pilots/`: stopped v1 and at most one v2. At most one may be active. Attempt and observation records are deletable derived state, owner-only, and never synchronized to Hub.

Records exclude prompts, queries, source and result bodies, paths, titles, link text, exact evidence tokens, provider prose, credentials, absolute paths, unrestricted errors, and internal reasoning. A redacted aggregate may publish only bounded counts, ratios, classes, failure codes, and digests.

Operational search selection, primary managed context, primary output, writes, verification, semantic publication, E1-E4 events, direct terminals, canary traffic, and production behavior remain unchanged. `shadow-selected` remains distinct from selected, loaded, injected, referenced, relevant, correct, understood, and used.

### Preserve the exact cost and review gate

Separately authorized execution may make exactly one attempt for each of 24 fresh samples and no more than 24 provider invocations. It permits no retry, replacement, repair turn, answer turn, semantic-publication call, or threshold change. Each turn retains the five-minute timeout, 4,096-byte result ceiling, complete-usage requirement, and cancellation-on-stop behavior.

The v1 review thresholds remain unchanged: 24 observed samples; exactly 24 invocations; 100% reviewed expected-path recall; at least 65% mean precision; at least 50% precision per observation; no more than eight returned sources; complete duration and token observations; and zero unavailable records, replay mismatches, privacy failures, adapter failures, invalid results, missing usage, dropped relevant candidates, or primary-effect differences.

Any failure rejects the pilot without retry. Passing authorizes only a separate canary-design decision.

| Code | Meaning |
| --- | --- |
| `provider_shadow_manifest_drift` | The source population, suite, protocol, schedule, or preparation binding changed or is incomplete. |
| `provider_shadow_candidate_drift` | A canonical candidate, expected-path exposure, content hash, byte count, class, or envelope differs from preparation. |
| `provider_shadow_attempt_state_invalid` | The durable attempt journal is missing, non-monotonic, unreadable, or disagrees with an adapter boundary. |
| `provider_shadow_adapter_failed` | Session start, injection, turn acceptance, terminal result, timeout, cancellation, or adapter binding failed. |
| `provider_shadow_result_invalid` | The provider result exceeds bounds or contains prose, malformed, unknown, altered, duplicate, or excessive tokens. |
| `provider_shadow_usage_unavailable` | Complete usage was not observed for an accepted selection turn. |
| `provider_shadow_observation_unavailable` | An accepted turn cannot produce a complete observed record and is represented by bounded unavailable evidence. |
| `provider_shadow_privacy_failed` | Private state or a redacted aggregate contains a prohibited field. |
| `provider_shadow_primary_effect_detected` | A primary context, output, write, verification, publication, or E1-E4 digest changed. |
| `provider_shadow_storage_failed` | Owner-only persistence or exact read-back validation failed. |

## Release impact

This decision adds only a benchmark contract and provider-free design verifier. It changes no CLI or bundled-private behavior and requires no release intent. A future executable harness enters the CLI dependency closure, must keep provider behavior behind adapters, must pass common provider-adapter contract tests, and requires reviewed `patch` release intent.

## Verification

- Bind the exact v2 contract bytes, v3 manifest digest, v8 suite and protocol digests, fresh 24-sample schedule, 16-candidate measured maximum, and 130,302-byte measured maximum.
- Prove that registered `sourceId` is translated once and prohibited from canonical candidates used by parsing and review.
- Prove provider-free that every sample and adapter-local coordinate is fresh and unique.
- Simulate valid selection, invalid identity, every persisted-state kind, and bounded unavailable materialization without creating an adapter or provider call.
- Prove that any v2 state refuses execution and recovery authorizes zero calls.
- Prove retention permits exactly stopped v1 plus at most one v2 while preserving every no-effect boundary.
- Run focused tests, repository quality and documentation checks, knowledge migration and lint, and task-base release-completion review.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0253: Pre-register an effect-free provider-shadow pilot](0253-pre-register-effect-free-provider-shadow-pilot.md)
- [Provider-shadow v1 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v1.md)
- [Phase-A pilot v3 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md)
- [Human-reviewed linked-evidence v8 suite](../../../../benchmarks/search/linked-evidence-reconciliation-v8.json)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
