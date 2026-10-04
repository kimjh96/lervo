# Phase A delivery

## Validation and completed modules

- Validation covers pair invariants, category coverage, expected paths, authority, privacy, and fail-closed behavior. Korean and English suites run separately against the same corpus state, recording per-pair, per-task, Korean corpus-limit, and baseline-regression observations.
- Agent pre-review covered all 20 pairs and 32 grounding cases. Human review remains required for provenance promotion, production-quality claims, and activation.
- Provider-neutral grounding outside `@lervo/search` is complete. It checks intent, reference, source class, authority, disposition, and behavior.
- Terminal selection, exact-hash loading, bounded hook assembly, and telemetry are separate completed modules. Candidate, selected, loaded, and hook-prepared observations remain distinct. Provider injection is unobserved; provider use is unknown.
- Answer-grounding judgment requires a managed content-addressed answer artifact and provider delivery receipt, with named unavailable, invalid, stale, missing, and truncated failures.
- The inactive, rejected `local-hybrid-v1` runtime package, registry entry, benchmark command, and dependency were removed; historical evidence remains. Runs and reports must not be combined. Rejected versions must not be silently activated.

## Phase A implementation

Phase A used a provider-neutral projection port, reviewed `patch` intent, exact v8 resolver parity, owner-only bounded observations, differential no-effect tests, adapter common-contract tests, and complete repository verification. Operational `lexical-v1`, direct terminals, provider calls, context selection, E1-E4 evidence, output, and writes remained unchanged.

## Registered pilot history

### v1: evaluator authorization blocked completion

[ADR-0249](../../../decisions/search/activation/0249-authorize-isolated-registered-corpus-phase-a-pilot.md) bound one isolated 286-document corpus and 30 runs. Provider-free replay found 24 nonempty projections, but [pilot v1](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v1.md) stopped after ordinal 1.

The primary run and verification passed; one private observation replayed exactly. The mandatory separate Codex writing-publication evaluator failed because pre-registration prohibited that production answer-quality call. Ordinals 2-30 were neither called nor replaced. A reviewed decision and user authority had to budget both provider passes and define eligibility for publication-blocked `run.completed` observations.

### v2: missing target triggered fail-closed rejection

[ADR-0250](../../../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md) preserved the two-pass lifecycle with 30 fresh samples. [Pilot v2](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md) stopped without retry at ordinal 2.

Ordinal 1 was search-eligible despite blocked publication. Ordinal 2 lacked its exact target in provider-visible single-file instructions, attempted to change ordinal 1 output, and was rejected before `run.completed`. The fail-closed boundary passed; the population gate failed.

[ADR-0251](../../../decisions/execution/orchestration/0251-declare-each-managed-write-target-to-provider.md) made every exact managed target provider-visible for single- and multi-file turns while retaining write-bridge enforcement. Pilot v2 remains immutable.

### v3: isolated gate passed

[ADR-0252](../../../decisions/search/activation/0252-authorize-corrected-target-delivery-phase-a-pilot.md) bound corrected-target v3 and retained v1-v2. [Pilot v3](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v3.md) completed 30/30 eligible samples with:

- 30 immutable observations and 24 nonempty projections.
- No unavailable records, replay mismatches, or privacy failures.
- Exactly 60 provider invocations.
- Publication allowed for four samples and blocked for 26.

Four Node-fleet repetitions truncated 19 candidates to eight and 42,013 bytes, then replayed exactly. The isolated gate passed. Provider shadow, canary traffic, and production activation remained unauthorized.
