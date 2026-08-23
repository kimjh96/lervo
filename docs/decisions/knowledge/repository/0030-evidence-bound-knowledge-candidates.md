# ADR-0030: Converged knowledge candidates and local diagnostics

Status: `accepted`
Decision date: 2026-08-19

## Context

`knowledge.candidate.created` existed without a source schema or creation boundary. Building candidates from a completion event alone could turn `no_consensus`/failure into conclusions or reuse verification for another claim revision. Trace and doctor must rebuild candidate–outcome–decision–verification links from local sources, not a separate authoritative index.

## Decision

### One small candidate per accepted claim

`@lervo/knowledge` revalidates complete policy, artifact history, verification evidence, and outcome. Only `converged` outcomes produce one candidate per currently accepted claim, containing claim ID/digest, outcome and decision/CAS coordinates, affected relative paths, completion/decision/verification event IDs, verification artifact/result identity/hash, one repository revision, review interval, and explicit conflicting candidate IDs.

Derive candidate ID from remaining canonical JSON. Store and read-verify one CAS object per claim; never append candidates to one file.

### Separate completion from creation

- Match `deliberation.completed` to current SQLite source.
- Require exactly one artifact-recorded event for decision and each verification plus every referenced evidence event.
- Revalidate decision CAS bytes/coordinates.
- Reject non-converged outcomes as `candidate_not_eligible/outcome_not_converged`.
- Reject missing paths/evidence or mixed repository revisions.
- Do not emit a duplicate event for an already recorded deterministic candidate.
- CAS may retain an object after event failure, but an eventless object is not knowledge and completion is not returned.

### Source-based trace and doctor

Trace verifies the event hash chain and returns allowlisted events for `last` or an explicit run in sequence order. Doctor opens project storage and verifies:

1. SQLite hash chain
2. Candidate CAS schema, canonical bytes, digest, and ID
3. Candidate-event claim/outcome/decision/path/revision coordinates
4. Evidence-event presence and converged completion
5. Decision/verification artifact events and decision CAS source

This first doctor scope covers local knowledge evidence. ADR-0033 adds manifests, skill lock, and provider binaries. Hub state remains unchecked and is never reported healthy.

### Event and failures

`knowledge.candidate.created` requires candidate/artifact IDs and hash, claim digest, relative paths, evidence IDs, outcome and decision IDs, verification artifact IDs, and verified revision. Exclude claim/decision bodies, candidate JSON, prompts, payloads, tool input, credentials, and reasoning. Reject non-content-addressed artifact IDs or missing fields after redaction.

- `candidate_not_eligible/outcome_not_converged`: non-converged outcome
- `candidate_evidence_invalid`: source events/CAS/revisions disagree
- `candidate_contract_invalid`: invalid paths/schema/self-reference/duplicates
- `artifact_storage_failed`: CAS write/read-back failure
- `event_recording_failed`: creation transaction failure

No failure claims candidate, reviewed, verified, or current state. Fixtures create candidates from converged history, reject duplicates/non-convergence, diagnose missing CAS, reconstruct latest trace, verify the event chain, and prove bodies remain absent.

## Consequences

The boundary from convergence to candidate is locally verifiable. Candidates remain review-only; ADR-0031 adds human review, promotion, and staleness.
