# ADR-0296: Reject activation after typed-context managed canary v14

Status: `accepted`
Date: 2026-08-30

## Context

Managed canary v14 completed eight Codex and eight Claude native-session runs with no technical failures, selection calls, retries, API keys, writes, or repository mutations. Every run achieved 100% recall. Codex passed every precision gate, but Claude's 60.07% mean precision was below the 65% provider minimum, and two Claude runs were below the 50% per-run minimum.

The typed boundary removed E4 tokens from `governance_context`, disproving the prior diagnosis that governance documents failed merely because they shared the evidence-token shape. Instead, failed Claude observations referenced token-bearing `task_evidence` beyond the reviewed expected claim set. Raw output remained unfiltered, and expected identifiers remained hidden.

## Decision

Reject product activation after v14 and retain the default-off predecessor. V14 is immutable terminal negative evidence: do not retry, repair, replace, reclassify, or rescore its observations.

Before another implementation or provider call, require a provider-neutral diagnosis of task-evidence eligibility. Any successor must distinguish classification from claim relevance without exposing expected evaluation identifiers, filtering raw E4 evidence, adding provider-specific routing, or relaxing these gates:

- 100% recall in every run.
- At least 50% precision in every run.
- At least 65% mean precision for each provider.

This decision creates no event or state and grants no authority for provider calls, writes, Hub, operational search, managed context, or production activation.

## Consequences

V14 shows that the typed governance boundary restores Codex recall and preserves exact task delivery, but it does not provide reliable cross-provider precision control. Speed improved relative to v12, and deterministic selection still halved the reviewed provider-call ceiling, but neither result offsets Claude's failed accuracy gates.

Provider-reported token totals are observational and do not establish billed savings. No further live measurement is authorized without a separately reviewed diagnosis and a fresh source-current checkpoint.

## Verification

- Bind the exact v14 manifest and observation-set digests in the terminal report.
- Confirm 16 completed runs, zero technical failures, zero selection calls, and identical repository-status digests.
- Recompute provider duration, recall, precision, failure counts, and reported usage from unfiltered observations.
- Confirm default-off behavior and that activation state did not change.
- Run quality, documentation, knowledge, full-repository, and exact-base release-completion checks.

## References

- [V14 execution decision](0295-authorize-typed-context-managed-canary-v14.md)
- [V14 terminal evidence](../../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v14.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
