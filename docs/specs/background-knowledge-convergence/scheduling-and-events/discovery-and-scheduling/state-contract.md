# State contract

Every local state binds obligation ID, source event/hash or baseline event/hash, source snapshot and debt digest, current stage, exact predecessor receipt, lease generation, agent assignment, delegation hash, attempt count, and next wakeup or dependency. Private candidate paths are resolved through hashes, not durable event bodies.

| State | Required additional proof | Meaning and recovery |
| --- | --- | --- |
| `queued` | Stage and available-at | Durable work exists; no completion claim. |
| `running` | Exact unexpired lease and assignment | One stage is executing; expiry requires inspection. |
| `waiting_review` | Non-null candidate hash, reviewer, queued successor | Automatic review remains scheduled. |
| `waiting_authority` | Exact decision/delegation dependency and owner | Authority is insufficient; resume only after a bound change. |
| `retry_scheduled` | Normalized failure, attempt, next-at | A transient failure has bounded backoff. |
| `stale` | Freshly observed mismatching source/context hash | Supersede against a new snapshot; never reuse approval. |
| `recovery_required` | Journal/target observation digest and owner | Effects are uncertain; no write retry before inspection. |
| `attention_required` | Bounded reason, owner, recovery condition | Exhausted or nontransient failure; visible, not discarded. |
| `current` | Exact stage receipts and verified currency digest | Bound scope completed; global completion also binds full baseline coverage. |
| `superseded` | Successor obligation ID/hash | New source replaced this scope without rewriting history. |
