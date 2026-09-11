# Managed Process Observation

Every adapter exposes synchronous, read-only process observation bound to its exact managed session. Only a transport that directly owns and inspects a native process may report `running` or `exited`.

- Codex app-server reports its owned child-process state.
- Codex Responses reports `no_managed_process`.
- Claude Agent SDK reports `transport_state_unavailable` because the SDK exposes no native process inspection contract.

Session registration, recent events, and successful turns never substitute for process evidence. Managed orchestration records the bounded result after session start, after each terminal turn, and before shutdown, without granting agent, assignment, or completion authority.

See [ADR-0372](../../../../decisions/execution/orchestration/0372-observe-managed-provider-process-state-through-adapters.md).
