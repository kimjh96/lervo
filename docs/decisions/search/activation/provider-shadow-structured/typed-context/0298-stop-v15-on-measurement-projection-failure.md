# ADR-0298: Stop v15 on measurement projection failure

Status: `accepted`
Date: 2026-08-30

## Context

Managed canary v15 bound the provider-neutral claim-eligibility implementation and passed provider-free repository verification. Its first scheduled Codex native-session task completed the provider turn, but the canary measurement adapter attempted to read `contextEvidence` from the public managed-run outcome. That outcome intentionally exposes only a bounded search summary, so the missing property caused a post-turn `TypeError`.

The fail-first controller persisted one failed observation and stopped. V15 made one Codex task call, zero selection calls, used zero API keys and zero retries, and performed no repository writes. It produced no accepted accuracy observation and cannot support activation.

## Decision

Preserve v15 as immutable terminal technical-failure evidence. Do not retry, repair, replace, resume, or reinterpret its first run.

Project sorted, deduplicated `referencedDocumentIds` and their count from canonical E4 evidence into the existing managed search summary. The successor canary maps these bounded IDs to the exact current corpus versions. It must not parse unrestricted provider prose, compare references with hidden expected identifiers before observation, or expose full context evidence through the public managed-run outcome.

This projection is derived state, not a new event. ADR-0297 and the execution specification define its fields, privacy boundary, and missing-field meaning. Provider-free tests must prove that only canonical E4 entries appear and that non-E4 injected documents do not.

After full provider-free verification, prepare a fresh source-current v16 checkpoint using the unchanged population of eight Codex and eight Claude runs and the unchanged accuracy gates. The user's explicit autonomous-completion direction permits exact authorization only after the new manifest is prepared and reviewed. Production activation remains conditional on a terminal passing v16 review.

## Consequences

Report the provider call spent by v15 as failed experimental overhead, not a successful sample or retry. The successor starts with new run IDs, attempt records, source/build binding, and retention coordinates.

## Verification

- Bind the v15 prepared-manifest and failed-observation-set digests.
- Confirm exactly one failed Codex observation, one task provider call, zero selection calls, and no accepted accuracy result.
- Prove the managed-run summary derives only unique E4 document IDs.
- Rebuild the CLI and rerun provider-free common-contract and repository checks.
- Prepare and review a new v16 manifest before any further provider call.

## References

- [Claim reference eligibility](0297-separate-claim-reference-eligibility-from-task-evidence.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
- [Execution and evidence specification](../../../../../specifications/execution.md)
