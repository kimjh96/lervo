# ADR-0030: Converged knowledge candidates and local diagnostics

Status: `accepted`
Decision date: 2026-08-19

## Context

`knowledge.candidate.created` lacked a source schema and creation boundary. Creating candidates from completion alone could turn `no_consensus` or failure into conclusions or reuse verification from another claim revision. Trace and doctor must reconstruct candidate, outcome, decision, and verification links from local sources, not a separate authoritative index.

## Decision

### One small candidate per accepted claim

`@lervo/knowledge` revalidates the complete policy, artifact history, verification evidence, and outcome. Only `converged` outcomes create candidates, one per currently accepted claim. Each candidate contains the claim ID and digest; outcome and decision/CAS coordinates; affected relative paths; completion, decision, and verification event IDs; verification artifact/result identity and hash; one repository revision; review interval; and explicit conflicting candidate IDs.

Derive the candidate ID from the remaining canonical JSON. Store and read-verify one CAS object per claim; never append candidates to a shared file.

### Separate completion from creation

- Match `deliberation.completed` to the current SQLite source.
- Require exactly one artifact-recorded event for the decision, each verification, and every referenced evidence event.
- Revalidate decision CAS bytes and coordinates.
- Reject non-converged outcomes as `candidate_not_eligible/outcome_not_converged`.
- Reject missing paths or evidence and mixed repository revisions.
- Do not emit another event for an already recorded deterministic candidate.
- CAS may retain an object after event failure, but an eventless object is not knowledge and completion is not returned.

### Source-based trace and doctor

Trace verifies the event hash chain and returns allowlisted events for `last` or an explicit run, in sequence order. Doctor opens project storage and verifies:

1. The SQLite hash chain.
2. Candidate CAS schema, canonical bytes, digest, and ID.
3. Candidate-event claim, outcome, decision, path, and revision coordinates.
4. Evidence-event presence and converged completion.
5. Decision and verification artifact events and the decision CAS source.

This initial doctor scope covers local knowledge evidence. ADR-0033 adds manifests, skill lock, and provider binaries. Hub state remains unchecked and is never reported healthy.

### Event and failures

`knowledge.candidate.created` requires candidate and artifact IDs and hash, claim digest, relative paths, evidence IDs, outcome and decision IDs, verification artifact IDs, and verified revision. Exclude claim and decision bodies, candidate JSON, prompts, payloads, tool input, credentials, and reasoning. Reject non-content-addressed artifact IDs or fields missing after redaction.

- `candidate_not_eligible/outcome_not_converged`: non-converged outcome.
- `candidate_evidence_invalid`: source events, CAS, or revisions disagree.
- `candidate_contract_invalid`: invalid paths, schema, self-reference, or duplicates.
- `artifact_storage_failed`: CAS write or read-back failure.
- `event_recording_failed`: creation transaction failure.

No failure asserts candidate, reviewed, verified, or current state. Fixtures create candidates from converged history, reject duplicates and non-convergence, diagnose missing CAS, reconstruct the latest trace, verify the event chain, and prove bodies remain absent.

## Consequences

The transition from convergence to candidate is locally verifiable. Candidates remain review-only; ADR-0031 defines human review, promotion, and staleness.
