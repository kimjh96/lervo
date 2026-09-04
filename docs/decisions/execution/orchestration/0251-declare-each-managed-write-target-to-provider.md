# ADR-0251: Declare each managed write target to the provider

Status: `accepted`

## Context

Managed write authorization binds exact repository-relative paths and rejects all other mutations. Provider-visible turn instructions previously named the target only for schedules containing multiple files, requiring a single-file provider to infer its target even though the write bridge knew the exact path.

The registered-corpus [phase A pilot v2](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md) exposed this ambiguity. Its second run treated the retained first output as the current target and attempted to modify it. The bridge rejected the mismatched coordinates before `run.completed`, but the provider should have received the target explicitly.

## Decision

For every managed-write provider turn:

- Append the exact repository-relative target path.
- Instruct the provider to change only that path through one complete provider file-change request.
- State explicitly that a second request fails the run.

Apply this provider-neutral orchestration rule to one-file and multi-file schedules. Do not add a target instruction to read-only turns.

The managed write bridge remains authoritative. Provider-visible text neither grants write authority nor proves compliance. Authorization, completion coordinates, repository snapshots, and byte verification continue to enforce the path boundary. This rule adds no event or state and stores no source body or unrestricted error.

## Failure meaning

A provider request for another path or a second request for the completed path remains `contract_validation_failed`. A provider that makes no verified change still fails the managed run. The explicit path and one-request instruction reduce ambiguity without relaxing either failure.

## Consequences

Single-file managed tasks no longer depend on repository artifacts or model inference to discover their declared output. Provider adapters remain unchanged, and Codex and Claude receive the same instruction contract.

The stopped pilot is neither resumed nor reinterpreted. A fresh experiment still requires separate population and provider-call authority.

## Verification

Common orchestrator tests capture accepted turn requests for both Codex and Claude fixtures and require the exact target and single-path instruction. Existing managed-write authorization, unexpected-change, snapshot, and verification tests remain in force.

## References

- [Execution specification](../../../specifications/execution.md)
- [ADR-0250: Authorize two-pass registered-corpus phase A pilot](../../../decisions/search/activation/0250-authorize-two-pass-registered-corpus-phase-a-pilot.md)
- [Pilot v2 evidence](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v2.md)
- [Managed-run CLI vertical slice](0015-lervo-run-cli-vertical-slice.md)
