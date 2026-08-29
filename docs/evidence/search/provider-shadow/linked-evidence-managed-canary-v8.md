# Managed linked-evidence canary v8 terminal report

Status: `terminally_stopped`
Date: 2026-08-29

V8 bound exact manifest `sha256:610bfea5a0b76b7481715744efaff6fc1b3365d387603846ffc74e8051cbeeca` and persisted ordinal 1. The read-only role passed, and Codex created a native session. Context preparation then rejected a recommendation at the injected 10:55 clock because the provider coordinator had fallen back to the actual 10:51 clock.

The adapter-start wrapper recorded one provider boundary start, and the event store proves a session started, but no provider turn or usage event occurred. The stored count is not evidence of model inference, token consumption, or billing. No selection call or Claude run occurred.

V8 is not retried. V9 passes the injected clock through the provider coordinator while preserving all credential, effect, selection, and fail-first bounds.

## Evidence

- Prepared manifest digest: `sha256:610bfea5a0b76b7481715744efaff6fc1b3365d387603846ffc74e8051cbeeca`
- Failure observation file digest: `sha256:279fa3c0cfb700189e136596f6bc9e146df26b35fe395f46e7dc625947c3c245`
- Completed model runs: 0
- Native sessions created: 1 Codex, 0 Claude
- Provider turns started: 0
- Provider usage observations: 0
- Selection calls: 0

## References

- [V8 role decision](../../../decisions/search/activation/provider-shadow-structured/0287-use-read-only-machine-role-for-key-free-managed-canary-v8.md)
- [V9 clock decision](../../../decisions/search/activation/provider-shadow-structured/0288-share-execution-clock-for-key-free-managed-canary-v9.md)
