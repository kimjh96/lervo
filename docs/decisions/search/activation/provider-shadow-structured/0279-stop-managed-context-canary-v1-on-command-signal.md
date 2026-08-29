# ADR-0279: Stop managed-context canary v1 on a command signal

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0278](0278-prepare-exact-managed-context-canary-checkpoint.md) prepared 16 read-only managed task runs with a 32-call ceiling. The operator authorized only manifest `sha256:79e872f22eb072e0e75e8292ccff386f683b8979b61a016f49128e5cb60c6182`, without retry, repair, fallback, replacement, write, production, Hub, or direct-terminal authority.

The first Codex selection turn emitted one `provider.command.executed` signal. Because the canary contract forbids command execution during selection, the common managed-canary boundary stopped the run before result parsing, source selection or loading, managed task context delivery, or the ordinary task call.

## Decision

Reject and terminally stop managed-context canary v1 after its first provider call. Do not run the remaining 15 scheduled runs or retry or replace ordinal one. Keep the default-off `linked-evidence-managed-canary-v1` policy and the unchanged `lexical-v1` operational search.

The immutable owner-only failure record is `lcanary_0c3d6b1574a0807612597531`, with file digest `sha256:19f96b1359ce5976fa03be50e824682274fd126d1828a950505243c52218b60a`. It records `canary_selection_unavailable`, 12,044 ms, six candidates, 42,333 provider-visible source bytes, zero selected, loaded, injected, or referenced sources, and unavailable usage totals. The isolated source repository status digest remained `sha256:47b29ad14d5304732bf11ca97060af58528351e3d32890b76c910583c74d2fc1`.

Treat the command signal as a capability-boundary failure, not an answer-quality or retrieval-quality result. The Codex adapter used a read-only sandbox and denied approval but still advertised command execution. The prepared Claude selection configuration removes tools; this is a diagnosis based on adapter configuration and the observed signal, because Claude did not run in v1.

The provider-neutral selection boundary requires a named `read_only_no_tools` adapter configuration and must check the started session's effective capabilities before candidate injection or a model turn. `toolCalls`, `commandExecution`, and `fileChanges` must all be `unsupported`; otherwise, selection must record `canary_selection_unavailable`, stop the local session, and make zero selection turns. Claude sessions configured with an empty tool list now report that exact capability state.

Codex app-server 0.150.1 exposes no thread- or turn-level no-tool control in its generated `ThreadStartParams` or `TurnStartParams` schema. Its read-only session therefore reports tool and command support and fails the new preflight before a selection turn. Feature flags are not proof that no tool can be called. Another paired canary requires a future Codex transport that exposes and attests an actual no-tool boundary.

Any later attempt must use a new immutable checkpoint and fresh exact operator authorization. V1 cannot resume.

## Consequences

V1 produced no completed task run or recall, precision, task-duration, or task-token population. No managed-context quality, speed, accuracy, or token-improvement claim is permitted. Avoiding 31 of the 32 authorized calls demonstrates safety-budget preservation, not performance savings.

Read-only filesystem policy and no-command provider capability are distinct guarantees. Future eligibility must independently prove filesystem, tool, command, and file-change capabilities. The preflight prevents recurrence but neither makes the current Codex transport eligible nor produces a performance sample.

## Verification

- Bind the exact prepared manifest, operator approval, first-run coordinates, failure record, and unchanged source repository status digest.
- Confirm exactly one Codex selection call, zero Codex task calls, and zero Claude calls.
- Confirm zero selected, loaded, injected, referenced, task-completed, write, production, Hub, direct-terminal, retry, repair, fallback, or replacement effects.
- Use provider-free fixtures to prove that the current Codex adapter starts zero selection turns and that an empty-tool Claude session completes the same structured selection contract.
- Run documentation lifecycle, knowledge migration and lint, repository quality checks, and exact-base release completion.

## References

- [Managed-context canary decision](0277-stage-managed-context-relational-canary.md)
- [Prepared checkpoint decision](0278-prepare-exact-managed-context-canary-checkpoint.md)
- [V1 evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v1.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
