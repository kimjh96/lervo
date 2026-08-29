# ADR-0250: Authorize two-pass registered-corpus phase A pilot

Status: `accepted`

## Context

[Pilot v1](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v1.md) stopped after its first primary managed run produced a private, exactly replayable linked-evidence shadow observation. The mandatory separate Codex semantic publication evaluation then blocked human publication and returned a nonzero CLI result. [ADR-0249](0249-authorize-isolated-registered-corpus-phase-a-pilot.md) had incorrectly limited each sample to one provider call and classified every nonzero CLI result as a failed search observation.

The user approved a replacement that preserves production managed-run and publication behavior, budgets both provider passes, and determines search-observation eligibility from completed-run and shadow contracts rather than human writing quality. Pilot v1 and its canonical evidence remain immutable and contribute no sample to the replacement population.

## Decision

### Bind a new population and preserve production behavior

Use contract `benchmarks/search/linked-evidence-shadow-phase-a-pilot-v2.json` and pilot ID `linked-evidence-shadow-phase-a-registered-v8-two-pass-20260828`. Build a fresh, isolated registered corpus from the unchanged public v8 suite. Exclude both pilot decisions and pilot-v1 evidence so experiment-control documentation cannot affect retrieval.

Do not mutate or resume pilot v1. The derived-state root may temporarily contain exactly two pilot directories: the stopped v1 predecessor and one active v2 replacement. Only v2 may execute. Both are owner-only, local, deletable projections. The canonical repository registry, operational search, managed context, direct terminals, and project identity remain unchanged.

Complete repository implementation, documentation, knowledge, and verification before preparation. Before any provider call, record in the current workstream the digest of an owner-only v2 manifest binding:

- the final source revision and working-tree-status digest;
- exact contract and suite digests;
- the built CLI digest;
- project identity;
- ordered corpus coordinates and digest;
- dry-run projections; and
- the exact 30-run schedule.

Keep the runtime digest outside this ADR to avoid self-referential source-snapshot mutation.

### Budget the production two-pass lifecycle

Run the same 30-query schedule authorized for v1, with distinct output paths and verification suites. Permit at most:

- 30 primary Codex managed task invocations;
- 30 mandatory separate Codex semantic publication-evaluation invocations; and
- 60 provider invocations total.

Do not add retries, replacement samples, grounding calls, provider shadow, repair turns, or canary effects. A primary failure before publication evaluation consumes only calls actually started and stops the pilot. Any timeout, signal, contract drift, source drift, incomplete semantic evaluation, missing `run.completed`, project-verification failure, unexpected managed change, missing or unavailable shadow observation, privacy failure, or replay mismatch also stops the pilot without retry.

### Separate search eligibility from publication eligibility

A scheduled sample is eligible only when:

- primary execution emitted `run.completed`;
- project verification passed and exactly the declared output path changed;
- the mandatory semantic publication evaluation reached `completed`;
- the writing-publication result is either `allowed` with CLI status 0 or `blocked` with CLI status 1; and
- exactly one immutable `observed` linked-evidence record exists for the run.

Retain writing status, failed checks, and the evaluation-artifact coordinate in the owner-only receipt. A publication-blocked sample remains eligible for the phase A search-incidence and projection-safety question. This neither reinterprets the answer as publishable nor counts writing failure as quality success. Any other nonzero result is ineligible and stops the pilot.

The final review retains ADR-0248's gate: exactly 30 eligible observations, at least 10 nonempty projections, zero unavailable records, zero privacy failures, exact replay equality, and explicit review of every truncation. It also verifies no more than 60 provider invocations and reports allowed and blocked publication counts separately.

## Failure meaning

- `managed_run_incomplete`: the primary run lacks `run.completed`, passed verification, or the exact declared change.
- `semantic_publication_evaluation_incomplete`: semantic evaluation did not complete, or publication status and CLI exit do not form an allowed pair.
- Existing shadow failure codes retain their meanings from ADR-0248.

No failure authorizes retry, sample replacement, production publication changes, provider-shadow selection, or E1-E4 context effects.

## Consequences

A passing pilot can complete the limited phase A incidence, determinism, bounds, and privacy gate for this isolated registered population. It cannot establish answer quality, provider use, general production incidence, provider-shadow authority, or canary authority.

Publication-evaluation cost becomes explicit. Search evidence no longer depends on whether a separately evaluated human-facing answer is publishable, while both outcomes remain observable and distinct.

## Observed outcome

[Pilot v2](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md) prepared the exact 286-document corpus and 30-run schedule, then stopped without retry at ordinal 2. Ordinal 1 completed, passed verification, produced an exactly replayable private shadow observation, completed semantic publication evaluation, and was search-eligible even though publication was blocked. The ordinal 2 provider turn was not told its exact single-file target in provider-visible instructions, selected the retained ordinal 1 output instead, and was rejected by the managed write bridge before `run.completed`.

The failed-closed boundary worked, but the population gate did not pass. [ADR-0251](../../execution/orchestration/0251-declare-each-managed-write-target-to-provider.md) corrects the production-neutral instruction contract. Pilot v2 remains immutable; it cannot be retried or resumed, and a fresh population requires separate authority for its additional provider-call budget.

## Verification

- Focused tests prove both contract versions, the exact 30-run schedule, the 60-invocation cap, eligibility of publication blocking, and ineligibility of missing completion.
- Preparation proves exact source, CLI, contract, corpus, schedule, and dry-run bindings before provider execution.
- Execution and review prove run completion, verification, publication-evaluation completion, immutable observation count, replay, privacy, truncation, and invocation totals.
- Complete run structural review, `pnpm quality:check`, relevant tests, the complete repository check, knowledge migration and lint, and task-base release completion.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../0248-stage-linked-evidence-reconciliation-activation.md)
- [ADR-0249: Authorize isolated registered-corpus phase A pilot](0249-authorize-isolated-registered-corpus-phase-a-pilot.md)
- [Pilot v1 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v1.md)
- [Pilot v2 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md)
- [ADR-0251: Declare each managed write target to the provider](../../execution/orchestration/0251-declare-each-managed-write-target-to-provider.md)
- [Execution specification](../../../specifications/execution.md)
- [Managed-run CLI vertical slice](../../execution/orchestration/0015-lervo-run-cli-vertical-slice.md)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
