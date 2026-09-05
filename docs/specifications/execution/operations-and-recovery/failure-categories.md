# Failure Categories

| Category | Required behavior |
| --- | --- |
| Invalid contract or policy | Fail before provider or write execution. |
| Stale plan or snapshot | Produce a new read-only plan. |
| Approval missing or revoked | Deny capability. |
| Incomplete telemetry | Lower assurance; infer neither success nor use. |
| Verification failure | Do not emit successful completion. |
| Event commit failure | Roll back pre-commit bytes. |
| Post-commit cleanup failure | Preserve bytes and require recovery. |
| Uncertain remote effect | Record uncertainty; do not retry automatically. |
| Secret or unsafe source | Exclude content; retain bounded diagnostics only. |
