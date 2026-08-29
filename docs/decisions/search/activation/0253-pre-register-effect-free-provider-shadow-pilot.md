# ADR-0253: Pre-register an effect-free provider-shadow pilot

Status: `accepted`
Date: 2026-08-28

## Context

[Phase-A pilot v3](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md) passed the incidence, deterministic-replay, bounds, and privacy gate with 30 eligible runs and 24 nonempty linked-evidence projections. It did not ask a provider to select from those projections, so it cannot establish selection quality, provider use, or authority to change managed context.

[ADR-0248](../0248-stage-linked-evidence-reconciliation-activation.md) requires a separate reviewed decision before an extra provider turn. That decision must bind the selection protocol, adapter request and receipt, cost and cancellation policy, provider-result privacy, failure handling, sample size, human-reviewed quality ground truth, and release impact while leaving the primary run and context unchanged.

The user authorized design of the next stage, not execution. Provider calls, managed-context changes, canary traffic, and production activation remain unauthorized.

## Decision

### Pre-register only; do not execute

Adopt `benchmarks/search/linked-evidence-provider-shadow-pilot-v1.json` as a design-only contract. Preparing or executing it requires later explicit user authorization naming the exact checked-in contract and its maximum of 24 additional provider invocations.

Do not resume, retry, replace, or mutate phase-A pilots v1, v2, or v3. Do not create a primary managed run or semantic-publication evaluation. Keep operational `lexical-v1`, E1-E4 evidence, direct terminals, managed context, provider-visible primary instructions, primary output, writes, verification, and publication behavior unchanged.

### Reuse the immutable nonempty v3 population

Use only the 24 v3 observations with nonempty deterministic linked projections: the six human-reviewed lexical-hit cases from the public v8 suite, each with three ordinary repetitions and one phase-A recommendations repetition. Exclude both no-hit cases because they have no linked projection and cannot answer the provider-shadow question.

Preparation must bind the exact v3 owner-only manifest, isolated project and corpus, source and suite digests, ordered run IDs, immutable observations, queries, full five-document source recommendation batches, top-three ordinary selections, linked candidates, deterministic coverage, document IDs, content hashes, and source bytes. Stop before provider calls for any missing binding, changed byte, unexpected case, absent reviewed expected path, or count other than 24.

The public v8 expected paths remain the human-reviewed ground truth. Do not add fixture-specific terms or fixed sources, change expected paths, route by question category, use provider completeness declarations, infer completeness from confidence, or reinterpret v8 or v9 observations.

### Keep the provider turn separate and effect-free

Use Codex with `gpt-5.6-sol` through the provider-neutral adapter in read-only mode. Reuse the unchanged v8 stage-one selection protocol with digest `sha256:bc506625516adb55e7893cf159ea925f8b53c7d668b8be04b71f44c3a8d8bbe0`.

Each shadow request contains one public-suite query and an immutable candidate envelope containing only:

- the full ordered source recommendation batch;
- the deterministic one-hop linked prefix; and
- unchanged deterministic coverage computed from the top-three ordinary selections.

This measures post-recommendation selection without promoting any batch member to operational E1. Bind every source to an opaque document ID, exact content hash, byte count, and exact evidence token. Treat source bodies as untrusted data. Deny writes and repository inspection. Permit at most eight returned exact selection tokens, rejecting prose and unknown, altered, duplicate, or non-standalone tokens.

Provider-free reconstruction of the six cases produces at most 16 deduplicated candidate sources and 130,302 source bytes per envelope, with every reviewed expected path present. Preparation must reproduce those maxima exactly and remain below the independent 262,144-byte hard ceiling before calls are authorized.

The adapter request and receipt must bind project, source run, isolated shadow run and session, target and provider turns, adapter, provider, model, candidate-envelope digest, protocol digest, request digest, result digest, byte count, usage, and terminal status. Keep provider-specific session construction and parsing behind adapters. Never reuse a shadow coordinate as E1 `selected`, E2 `loaded`, E3 `injected`, or E4 `referenced` evidence.

### Bound cost, cancellation, and retention

Permit exactly one shadow selection attempt for each of 24 samples and at most 24 provider invocations total. Allow zero retries, replacements, repair turns, answer turns, semantic-publication evaluations, grounding calls, or canary effects. Each call has a five-minute timeout, a 262,144-byte provider-visible source ceiling, and a 4,096-byte result ceiling. Complete provider usage is required for review.

Stop before the next call on any manifest, source, suite, protocol, candidate, schedule, adapter, result, usage, privacy, storage, or primary-effect failure. Preserve partial owner-only evidence; do not replace the failed sample. Cancellation stops the active adapter session and authorizes no additional call.

Retain one active or stopped provider-shadow pilot under `.lervo/state/search/linked-evidence-provider-shadow-pilots/` as mode-`0600`, deletable derived state. Do not delete phase-A evidence to make room.

### Define the derived observation state

Each completed call creates exactly one immutable `linked_evidence_provider_shadow_observation.v1` record with status `observed` or `unavailable`. It must contain:

- observation, pilot, project, source-run, shadow-run, session, adapter, provider, model, target-turn, provider-turn, and adapter-receipt identifiers;
- source-manifest, snapshot, suite, selection-protocol, candidate-envelope, request, result, and usage digests;
- lexical, linked, coverage, candidate, shadow-selected, reviewed-relevant, and unexpected-selection counts;
- exact opaque candidate and shadow-selected document IDs with content hashes;
- provider-visible source bytes, result bytes, duration, observed token counts, terminal status, record status, and a nullable bounded failure code; and
- booleans proving unchanged primary context, output, writes, verification, publication, and E1-E4 event sets through exact before-and-after digest comparison.

Records must exclude prompts, queries, source and result bodies, paths, titles, link text, exact evidence tokens, provider prose, credentials, absolute paths, unrestricted errors, and internal reasoning. A redacted aggregate may publish case IDs, reviewed path-class counts, ratios, bounds, failure codes, and digests, but not raw provider results or session coordinates.

`shadow-selected` means only that the extra provider result returned a recognized exact token from the bound candidate envelope. It does not mean operational selection, loading, injection, reference, relevance, correctness, understanding, or use.

| Code | Meaning |
| --- | --- |
| `provider_shadow_manifest_drift` | The v3 manifest, population, suite, protocol, schedule, or source binding changed or was incomplete. |
| `provider_shadow_candidate_drift` | The reconstructed candidate envelope or reviewed expected-path exposure differed from preparation. |
| `provider_shadow_adapter_failed` | The provider session, request acceptance, terminal result, cancellation, timeout, or receipt contract did not complete exactly. |
| `provider_shadow_result_invalid` | The result exceeded its bound or contained prose, malformed, unknown, altered, duplicate, or too many tokens. |
| `provider_shadow_usage_unavailable` | Complete provider usage was not observed for the completed selection turn. |
| `provider_shadow_privacy_failed` | A record or aggregate exposed a prohibited field or failed owner-only validation. |
| `provider_shadow_primary_effect_detected` | Primary context, output, writes, verification, publication, or E1-E4 event digests changed. |
| `provider_shadow_storage_failed` | Immutable owner-only persistence or exact read-back validation failed. |

An unavailable record or any stop code means only that the provider-shadow sample or pilot was not proved. Neither authorizes retry, replacement, context change, canary traffic, or activation.

### Require an exact review gate

The pilot passes only with:

- exactly 24 eligible immutable observations and exactly 24 provider invocations;
- zero retries, replacements, unavailable records, replay mismatches, privacy failures, adapter failures, invalid results, missing usage observations, and primary-effect differences;
- zero dropped human-reviewed relevant recommendations, linked sources, or coverage sources;
- 100% reviewed expected-path recall across exposed candidates;
- at least 65% mean returned-selection precision and at least 50% precision in every observation;
- no more than eight shadow-selected sources in any observation; and
- complete aggregate duration and token observations, reported without treating observed tokens as billed cost.

Any failed or unobservable criterion rejects the pilot. Do not remove observations, borrow earlier provider results, merge v8, v9, or phase-A quality results, or relax a threshold after calls begin.

A passing review authorizes only a separate decision on whether to design a bounded canary. It does not authorize canary execution, E1 selection, E2 loading, E3 injection, E4 reference requirements, production answer-quality claims, provenance promotion, or activation.

## Release impact

This decision and the JSON pre-registration change only documentation and benchmark inputs. They add no CLI or bundled-private behavior and require no release intent. A future executable harness or managed-runtime integration enters the CLI dependency closure, must use provider-neutral ports, must pass common Codex and Claude adapter contract tests, and requires reviewed `patch` release intent before completion.

## Verification

- Validate that the contract binds the exact v3 manifest digest, 24 nonempty samples, public v8 suite digest, human-reviewed ground truth, unchanged selection-protocol digest, 16-source observed maximum, and 130,302-byte observed maximum.
- Prove without a provider that the six lexical-hit cases expose every reviewed expected path and remain within candidate, source-byte, result-byte, schedule, retention, and call bounds.
- Prove the design has no execution entrypoint and changes no operational policy, context, event, adapter, CLI, or provider behavior.
- Run documentation, natural-language evaluation, knowledge migration and lint, repository quality, and task-base release-completion checks.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0252: Authorize corrected-target-delivery phase A pilot](0252-authorize-corrected-target-delivery-phase-a-pilot.md)
- [Phase-A pilot v3 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md)
- [Human-reviewed linked-evidence v8 suite](../../../../benchmarks/search/linked-evidence-reconciliation-v8.json)
- [Managed context grounding and coverage](../../execution/providers/0198-managed-context-grounding-and-coverage.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
