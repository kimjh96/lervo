# ADR-0247: Confirm linked-evidence reconciliation v9

Status: `accepted`

## Context

Linked-evidence reconciliation v8 passed every pre-registered quality, duration, latency, selection, coverage, reconciliation, marker, response, provider-execution, and relevant-source preservation criterion except the token-ratio criterion. One model-direct provider execution failed: control usage was 23/24, while v8 usage was 24/24. Although the observed token ratio was below the registered maximum, incomplete control usage made the criterion unobservable and rejected v8.

This failure does not authorize reinterpretation, removal of the failed control turn, reuse of another run's usage, or activation. It permits one separately identified exact confirmation with a fresh contemporaneous control.

## Decision

Pre-register `linked-evidence-reconciliation-confirmation-v9` as an exact confirmation of `linked-evidence-reconciliation-v8`. Preserve the same eight cases, reviewed expected paths, lexical expectations, three repetitions, rotating arm order, model-direct control, stage protocols, protocol digest, recommendation-only one-hop link policy, source and byte bounds, deterministic coverage, no-hit behavior, scorer, acceptance thresholds, privacy contract, and failure meanings.

The v9 suite has a distinct suite and report identity. After removing only the v9 confirmation metadata and the v9 ADR's corpus self-exclusion, it must normalize exactly to the checked-in v8 suite. The runner delegates candidate execution and acceptance evaluation to the unchanged v8 contract and runner. Any semantic difference blocks execution before provider calls.

Run a fresh same-model control and candidate comparison. Do not merge, borrow, average, replace, or otherwise combine v9 observations with either v8 report. Analyze v9 only against its own pre-registered criteria. Any failed or unobservable criterion rejects the confirmation.

This decision authorizes evaluation only. `lexical-v1` remains operational unless a later reviewed decision separately authorizes activation.

## Consequences

The exact confirmation passed every pre-registered criterion. The unchanged candidate passed 21/24 grounded-answer observations versus 17/24 direct, passed every repetition for seven cases versus five, and achieved 100% expected-path recall versus 83.33%. Both arms recorded usage for all 24 observations and had zero provider-execution failures. The candidate used 54.10% of direct observed tokens and 57.93% of direct duration. Both no-hit latency criteria passed.

All candidate selection, coverage, reconciliation, source-marker, response, provider-execution, and relevant-source preservation contracts passed. The three candidate grounded-answer failures repeated the v8 terse-release overselection: ADR-0223 was selected, loaded, and exactly referenced alongside both reviewed expected paths. No expected path was missing.

This is positive confirmation evidence, not activation authority. Keep `lexical-v1` operational. A separate reviewed activation decision must define production routing, telemetry, rollback, release impact, and staged verification. See the [redacted v9 observation](../../evidence/search/linked-evidence-reconciliation-confirmation-v9.md).

## Privacy and failure meaning

Retain the v8 privacy policy and failure meanings unchanged. Queries, reviewed expected paths, repository-relative link coordinates, protocol and suite digests, and aggregate observations may be checked in. Raw provider prose and exact markers remain mode-`0600` operator output outside the repository.

`confirmation_contract_failed` means the v9 suite does not normalize exactly to the checked-in v8 suite or the report is not bound to the separate v9 identity. It blocks execution and does not reinterpret any v8 failure meaning.

## Verification

- Prove exact normalized equality between the v9 and checked-in v8 suites.
- Prove that the v8 protocol digest and implementation entrypoints remain unchanged.
- Run the sanitized dry-run before provider execution; verify all lexical, linked-source, coverage, no-hit catalog, corpus, and digest bindings.
- Bind the repeated report to the v9 suite, unchanged v8 protocol, repository snapshot, corpus, provider, model, repetitions, privacy policy, and acceptance criteria.
- Run focused contract tests, natural-language evaluation checks, repository quality and tests, documentation lifecycle, knowledge refresh and lint, and task-base release completion review.
