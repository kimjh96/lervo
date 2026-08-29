# ADR-0285: Authorize the exact key-free managed canary v6

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0284](0284-prepare-exact-deterministic-native-session-canary-v5.md) produced manifest `sha256:85a22b76aa5a07ab58e66eb58035cedbd64b83780b8c356b6cc835f1c90d8f02` with 16 nonempty paired runs, zero selection calls, zero provider calls, and false execution authority. Because the exact authorization and fail-first execution operation was implemented after that snapshot, v5 remains immutable but is source-stale for live use.

The user explicitly directed autonomous completion and required measurements on Codex and Claude. The execution operation translates that authority into an owner-only record bound to one fresh prepared-manifest digest. It records each attempt before its call, refuses retries, repairs, and replacements, and stores only bounded observations after the call. It rechecks current source and built CLI digests before every task.

## Decision

Prepare v6 over the same 16 paired source tasks after the execution operation and all tracked bytes converge. The exact v6 manifest may then be authorized and executed through eight ordinary read-only Codex `gpt-5.6-sol` tasks and eight ordinary read-only Claude `opus` tasks using existing provider-native signed-in sessions.

Deterministic selection creates no adapter, reads no credential, sends zero selection bytes, and makes zero provider calls. The total live ceiling is 16 task calls. User API keys, retries, repairs, replacement runs, writes, external messages, Hub effects, production routing, and default activation remain prohibited. A technical failure stops all later calls. Quality failures remain observable through the complete paired population but cannot activate the feature.

Persist each attempt before its call. An attempt without a terminal observation is an uncertain effect and cannot be repeated. Every observation records:

- Provider and model.
- Duration and provider-reported usage when available.
- Exact current E4 references, recall, precision, verification, and publication disposition.
- Before-and-after repository-status digests.

Observations must not contain prompts, paths, source bodies, result bodies, credentials, or unrestricted errors.

## Consequences

The key-free experiment can finish without requesting provider API keys from a Lervo user. Responses API support remains optional BYOK or CI behavior and has no role in this execution.

Passing every task and evidence gate makes the reviewed population eligible for a separate default-off activation decision. It neither proves production representativeness nor authorizes default routing. Failure preserves evidence and leaves existing lexical behavior unchanged.

## Verification

- Bind authorization to the exact current v6 manifest and recheck source and build bytes before every call.
- Prove at most 16 paired native-session task calls, zero selection calls, no selection adapter, no user API keys, and no repository effects.
- Independently calculate per-run and per-provider recall, precision, duration, usage, and the design-level call reduction against the original 32-call ceiling.
- Run focused and complete repository verification, knowledge migration and lint, and exact-base release completion after recording the final report.

## References

- [V5 checkpoint decision](0284-prepare-exact-deterministic-native-session-canary-v5.md)
- [Managed canary specification](../../../../specifications/execution/managed-linked-evidence-canary.md)
- [Measurement report](../../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
