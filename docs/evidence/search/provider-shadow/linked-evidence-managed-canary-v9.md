# Managed linked-evidence canary v9 terminal report

Status: `terminally_stopped`
Date: 2026-08-29

V9 bound exact manifest `sha256:b87d4b6769c0f9e4e3248ff19846c0154b6cac461f52bdf5615d696ad6dc1d47` and persisted ordinal 1. The advancing runtime clock caused the operational recommendation batch ID to differ from the exact manifest authorization, so deterministic selection rejected the run before adapter creation.

No provider session, model turn, usage event, selection call, or Claude run occurred. V9 will not be retried. V10 restores a manifest-bound observed time earlier than the live runtime.

## Evidence

- Prepared manifest digest: `sha256:b87d4b6769c0f9e4e3248ff19846c0154b6cac461f52bdf5615d696ad6dc1d47`
- Failure observation file digest: `sha256:8056970902a4113d5f7b3337cfa454ea968fca808a852d44bf6fe5509620711f`
- Adapter creations: 0
- Provider sessions: 0
- Provider turns: 0
- Provider usage observations: 0
- Selection calls: 0
- Claude runs: 0

## References

- [V9 runtime-clock decision](../../../decisions/search/activation/provider-shadow-structured/0288-share-execution-clock-for-key-free-managed-canary-v9.md)
- [V10 exact-clock decision](../../../decisions/search/activation/provider-shadow-structured/0289-use-past-manifest-clock-for-key-free-managed-canary-v10.md)
