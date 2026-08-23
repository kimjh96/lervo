# ADR-0027: Deliberation boundary hardening before runtime

Status: `accepted`
Decision date: 2026-08-19

## Context

Without decomposition, one history validator would own role isolation, transitions, verification, and outcomes. Deliberation also depended on full writing/verification execution packages merely to validate permits/results, pulling in CAS, storage, core, and YAML. Event allowlists did not enforce required or status-dependent fields.

## Decision

### Pure contracts

- `@lervo/writing-contract` owns canonical policy/evaluation/permit hashes and IDs.
- `@lervo/verification-contract` owns suite/result hashes, semantic validation, and result-artifact coordinate types.
- Both depend only on schemas and canonical JSON, not CAS, storage, commands, or evaluators.
- Execution packages re-export pure APIs for compatibility while retaining evaluation/publication or command/CAS responsibilities. `@lervo/deliberation` depends only on contract packages.

### Small history transitions

Split validation into:

- `history-coordinates`: order, predecessor, per-role run/session/receipt isolation
- `history-state`: claims, objections, verification, latest review, decision
- `artifact-transitions`: exhaustive closed-union transitions
- `history-validation`: validation order and analysis assembly
- `outcome-validation`: outcome and convergence

Artifact kinds are a persistent protocol, not an open plugin registry. New kinds require schema version, role responsibility, transition, and fixture changes under exhaustive switches.

### Error and event contracts

Keep broad `DeliberationError.code` disposition such as `artifact_contract_invalid`; add stable source-free `reason` values such as `provider_not_allowed`, `cross_role_session_reuse`, `stale_claim_verification`, and `independent_review_missing`. Runtime events project only approved short reasons, never exception text.

Give `deliberation.started`, `.artifact.recorded`, and `.completed` separate JSON Schemas and derived types. After allowlist redaction, validate required fields, IDs, rounds, kinds, and status-dependent decision/failure nullability. Missing or inconsistent payloads are `invalid_payload`; extra/source fields remain removed.

Separate fixture builders for real verification results and writing permits from scenario tests. Outcome tests specify expected objection/verification IDs rather than reimplementing production logic. Assert broad code and detailed reason.

Root build runs all package scripts in pnpm workspace topological order, not a manual package list.

### Privacy and failure

Schemas add no source. `invalid_payload` maps to `redaction_failed`; persist no partial event and close runtime as telemetry failure. Reason enums cannot contain prompts, bodies, responses, tool inputs, or credentials.

## Consequences

Deliberation semantics no longer pull execution/storage dependencies into orchestrators. Changes and diagnostics are localized, required event coordinates are checked before persistence, and ADR-0028 can build a same-provider runtime on these boundaries.
