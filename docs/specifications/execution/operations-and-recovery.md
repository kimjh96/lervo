# Execution Operations and Recovery

Related specifications are linked from the [execution specification](../execution.md).

## Events and privacy

The execution events and privacy specification defines allowlisted payloads, workforce events, knowledge and terminal integration events, additive terminal-observation compatibility, workstream snapshots, activation receipts, coverage, privacy exclusions, and failure meaning. It also owns reader compatibility, writer activation, and failure codes.

Events remain canonical hash-chained evidence; absent telemetry never becomes inferred success or provider-use claims. Managed linked-evidence canary record bounds and privacy exclusions remain defined by its specification.

Stage observation and performance defines timing, environment, projection, and performance gates. Missing evidence never becomes success, zero usage, duration, or inferred ancestry.

## Durable apply and recovery

The owner-only journal validates the plan and current bytes, stages outputs, backs up originals, publishes or deletes, lints, commits the event, then cleans backups and empty parents.

Pre-commit failure restores originals. Post-commit cleanup failure preserves outputs and requires recovery. Interrupted transactions block mutation. Rollback recreates only parents pruned by that transaction before restoring exact backups, including deleted shards and moved documents.

The adverse-condition safety specification defines the common effect inventory, exact completion/rollback/recovery projection, cancellation and backpressure bounds, telemetry field registry, threat model, capacity and retention profiles, and compatibility rehearsals. External uncertainty is never an automatic retry signal.

## Hub and remote execution

Hub and Node coordination is authenticated, scoped, policy-bound, and network-neutral. Signed organization policy adds tenancy and split issuance/delivery authority. Secret-free grants bind policy, target, permissions, generation, and time. Inactive or revoked grants fail before load; source bytes are cleared after loading, and receipts exclude material. Local execution remains independent.

Repository Node apply revalidates inputs and registers after three stable complete observations. Organization enrollment binds that evidence to active credential delivery. Rollout uses a one-Node canary, at-most-twofold waves, zero unavailable tolerance, and separate planning, approval, execution, and rollback; records claim no effect. Failure restores the predecessor or requires explicit rollback. User/provider bytes, trust, credentials, publication, onboarding, and legacy transitions retain separate authority.

### Workforce state

Repository workforce state uses durable role and agent identity, bounded parent depth, assignments, dependency and path scopes, short scheduler locks, renewable generation-bound leases, exact evidence handoffs, and CAS finalization. Same-role and mixed-role agents run concurrently only on disjoint scopes. Root agents and subagents use identical transitions.

`assignment.lease.renewed` retains only assignment, agent, lease, generation, and expiry; it excludes task prose, paths, prompts, output, reasoning, and credentials. Missing or rejected renewal leaves the prior lease authoritative until recorded expiry.

## Failure categories

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

## Required verification

Verification covers:

- Schema and redaction tests.
- Shared adapter contracts.
- Write and recovery failure injection.
- Transient service compensation and readiness.
- Synchronization empty-outbox, long-chain, gap, and cursor-conflict tests.
- Knowledge plan, apply, lint, and idempotence.
- Source privacy, path, symlink, size, and race tests.
- Applicable boundary, type, documentation, build, and distribution checks.
