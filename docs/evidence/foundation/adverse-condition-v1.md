# Foundation adverse-condition evidence

Status: `accepted`

As of: 2026-09-01

The [generated JSON report](adverse-condition-v1.json) is the bounded aggregate evidence for FH4. It binds the exact source-byte revision, protocol digest, current effect and growth inventories, deterministic recovery scenarios, event-field privacy registry, integrated threat model, capacity observations, compatibility rehearsals, focused suite hashes, and report identity.

## Accepted observation

Thirteen state-changing effect categories produced 65 deterministic crash projections. Every injected boundary resolved only to exact completion, exact rollback, or `recovery_required`; unknown external results never became retryable absence. Runtime-specific suite bindings cover provider admission, event and CAS append, managed writes, assignments and leases, workspaces, terminal persistence, capabilities, sync, remote commands, deployment, migrations, cancellation, duplicates, stale coordinates, and queue behavior.

The event telemetry audit classified all 552 current top-level allowlisted payload fields across the closed event catalog. It found no raw prompt, transcript, credential, secret, body, request text, context text, or provider output coordinate. The 15-case threat model passed its reviewed controls. Untrusted third-party execution remains disabled pending an out-of-process, revocable, resource-bounded isolation contract and conformance suite.

Seventeen growing collections have an explicit durable-lifetime, hard-count, current-replacement, acknowledged-purge, journal, or derived-pruning policy. Provider-free small, medium, large, and concurrent observations exercised windows up to 100,000 events, 10,000 assignments, and 32 concurrent workers. Exact environment and measurements remain in the generated report.

## Semantic gap closed

Provider start, stream, and stop failures previously inherited `retryable: true` even though a process or remote provider effect could continue after local failure. They now publish `retryable: false`. Content-addressed artifact storage remains the only current managed-run failure classified retryable. This prevents future loops from treating external uncertainty as safe absence.

Workforce limits now have one shared owner instead of private persistence literals. A pure assignment-DAG cancellation planner propagates through non-terminal dependents without mutating state or creating a second graph authority.

## Limits

Capacity observations cover provider-free in-memory windows and correctness, not live provider, network, Hub, storage-throughput, or disk-full performance. Canonical event and referenced CAS history is retained for the project lifetime and has bounded per-operation windows rather than destructive compaction. Exceeding those windows or storage capacity is explicitly unsupported or recovery-required.

FH4 does not implement arbitrary third-party process isolation, an unattended scheduler, dynamic graph mutation, or automatic retry. Those remain blocked. Focused suite hashes bind current tests; repository-wide test and distribution checks remain separate completion evidence.

## Verification

```bash
pnpm foundation:recovery:check
pnpm foundation:security:check
pnpm foundation:capacity:check
```

Each command rebuilds the pure verifier, validates report and suite identities, recomputes the current source-byte revision, confirms referenced threat evidence exists, and requires the full report to pass.
