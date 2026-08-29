# Managed linked-evidence canary v6 terminal report

Status: `terminally_stopped`
Date: 2026-08-29

V6 bound exact manifest `sha256:313b5406f7206d1ea8033fd5c13d0939e71eecf88e78382ac0dfde3118f0da97` and persisted ordinal 1 before attempting the Codex task. Before adapter start, the managed coordinator rejected the run because the `researcher` role requires `writing_en-human`, but the ordinary managed-run input supplied no resolved writing policy.

No result or provider usage event was observed. No selection adapter was created, no selection call occurred, no Claude run began, and repository status remained outside the provider phase. The initial bounded observation conservatively records one attempted task call because provider-start telemetry had not yet been separated from adapter creation. Validation order proves only that failure preceded adapter start; it does not convert the conservative stored count into provider usage or billing evidence.

V6 is not retried. Its successor separates provider starts from adapter creations and uses the machine-output `developer` role, whose null writing policy matches the managed-run contract. No API key is introduced.

## Evidence

- Prepared manifest digest: `sha256:313b5406f7206d1ea8033fd5c13d0939e71eecf88e78382ac0dfde3118f0da97`
- Failure observation file digest: `sha256:0b44394ee871d684712cb4fe6c0dcceaa69a6fa0b16541696fcdb5631f5a4b67`
- Completed runs: 0
- Conservative attempted task-call count: 1
- Selection calls: 0
- Provider usage observations: 0
- Later runs: 0

## References

- [V6 authorization decision](../../../decisions/search/activation/provider-shadow-structured/0285-authorize-exact-key-free-managed-canary-v6.md)
- [V7 correction decision](../../../decisions/search/activation/provider-shadow-structured/0286-use-machine-output-role-for-key-free-managed-canary-v7.md)
