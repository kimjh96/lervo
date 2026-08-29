# ADR-0301: Activate deterministic claim-eligible linked context

Status: `accepted`
Date: 2026-08-30

## Context

Managed canary v18 completed a fresh source- and build-bound population of eight Codex and eight Claude native signed-in task runs. All 16 runs completed with zero technical failures, selection calls, retries, API keys, or repository mutation. Both providers achieved 100% recall in every run. Codex achieved 83.33% mean and 66.67% minimum precision; Claude achieved 79.17% mean and 50% minimum precision. Every unchanged activation gate passed.

The passing behavior deterministically selects every current bounded one-hop linked candidate without a selection model. The exact-authorized canary path and its owner-only records remain experiment evidence, not a public activation interface.

## Decision

Activate `managed-linked-evidence-default-v1` for ordinary managed Codex and Claude runs. After lexical recommendation and before task-adapter creation, project at most eight registered one-hop linked candidates and 117,813 source bytes, then select every exact current candidate in projection order. Create zero selection adapters and make zero selection provider calls. The ordinary signed-in task adapter remains the only provider call; no API key, Hub connection, or user setting is required.

Keep `linked-evidence-managed-canary-v1` default-off and exact-authorized for reproducible experiments. Explicit exact canary authorization takes precedence over the default path and retains its existing completion or failure record. The default path creates no canary records. Its observable state is the ordinary provider-neutral E1 selection, E2 load, E3 injection, and optional E4 reference chain. Its E1 rule is `managed_linked_evidence_default:<selection-attempt-id>`.

Linked-only task evidence remains `referenceEligible: false`. Direct task provenance remains eligible and takes precedence when the same document is also linked. Governance remains ineligible. Selection, loading, injection, reference, and internal provider use remain separate claims; Lervo does not claim unobservable internal use.

An empty projection preserves the ordinary context plan and continues. An invalid engine, stale source, unsafe path, changed hash, duplicate source, or exceeded bound fails the managed run before task-adapter creation. There is no retry, silent baseline fallback, provider-specific core branch, or post-filtering of provider output.

## Consequences

Ordinary managed runs gain bounded linked supporting context locally and deterministically. Activation adds local corpus projection work but no model round trip, credential, canary traffic, or unbounded state. Historical v1-v18 contracts, records, and observations remain immutable.

V18 is evidence for the evaluated English-dominant eight-task population, not a universal quality or billing guarantee. Provider-reported token totals are descriptive and not mutually billable units.

## Verification

- Preserve the reviewed v18 manifest and terminal observation-set digests.
- Verify all unchanged recall, precision, privacy, capacity, no-effect, and repository-mutation gates.
- Run common Codex and Claude managed-run tests proving default E1-E3 delivery and exactly one task-adapter creation.
- Verify linked-only claim ineligibility, direct-provenance precedence, and exact canary compatibility.
- Run quality, full repository, release-completion, knowledge-migration, and knowledge-lint gates.

## References

- [V18 evidence](../../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v18.md)
- [Claim reference eligibility](0297-separate-claim-reference-eligibility-from-task-evidence.md)
- [Event-capacity predecessor](0300-stop-v17-and-expand-complete-event-capacity.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
