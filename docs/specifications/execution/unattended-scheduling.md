# Bounded unattended assignment scheduling

Status: `active`

As of: 2026-09-07

## Scope

`lervo loop schedule` is one bounded foreground scheduler invocation. It periodically rebuilds the current governed-work report, discovers an eligible assignment, claims it through the existing workforce compare-and-swap lease, and starts at most one managed provider run at a time. One invocation can continue across multiple assignments and retries without another manual trigger. It requires neither a Hub nor a second task store.

The scheduler is not an operating-system daemon, cron installer, provider session-resume mechanism, approval authority, or dynamic graph editor. A service manager may invoke the CLI, but it must preserve this command's limits, exit status, owner-only lock, and kill switch.

## Authority and selection

The command requires explicit `--write` and one `--provider`. Optional repeated `--agent` values narrow the eligible hired-agent set; omission means all currently active, compatible repository agents. The pure controller chooses only an action already recommended by the current governed report and then requires:

- The exact assignment revision and current workstream.
- A matching active agent role version and contract hash.
- Provider allowance, optional exact capability hash, and responsibility for every expected path.
- Deterministic priority and assignment ordering inherited from the governed report.
- An active lease whose session belongs to this scheduler before provider execution.

Claim rechecks the selected assignment revision under the existing scheduler lock. A race, conflicting lease, dependency change, or path conflict changes no provider state and may be re-observed only within the bounded consecutive-failure limit. A repository-local scheduler lock permits one invocation per repository process boundary; it is transient coordination, not canonical work state.

## Managed execution input

Assignments remain the task authority. The scheduler constructs a bounded instruction from the assignment ID, task type, and acceptance criteria. It passes the exact full expected-path set, verification suites, role, skills, and capability packages through the existing managed-run port. The provider remains behind its adapter. The scheduler neither reads a hidden prompt store nor persists generated instructions.

Managed runs now accept either the compatible single `expectedPath` input or an exact `expectedPaths` set. Supplying both, no path, duplicate paths, more than 128 paths, or an escaping path fails before provider startup.

## Bounds and stop behavior

Every invocation has positive bounded limits for polling interval, cycles, claims, managed runs, wall-clock admission time, consecutive recoverable failures, and lease duration. Existing governed policy independently enforces per-assignment attempts, parallel capacity, exact provider token dimensions, cache observations when supplied, and managed stage duration. A configured unknown or reached resource assessment still fails closed before another attempt and after a successful provider result.

The default kill switch is `.lervo/state/unattended-scheduler.stop`; `--kill-switch` may select another repository-relative path. Any entry at the exact path pauses the scheduler before a poll, claim, or provider start. The scheduler cannot claim that it preempts an already-running provider call. Provider adapter deadlines and managed terminal evidence retain that responsibility.

The scheduler:

- Completes successfully only after the governed report observes all assignments complete.
- Pauses successfully when an invocation bound is reached or the kill switch is engaged.
- Returns attention-required for invalid or blocked governance, escalation, no compatible agent, cancellation work, rejected output, exhausted budget, or non-retryable execution failure.
- Waits within its bounds for incomplete dependencies, missing approval, no assignments, or a foreign active lease.
- Never grants approval or applies cancellation automatically.

## Retry and uncertain effects

A provider admission with no recorded attempt is known pre-effect and may be retried. A recorded terminal failed attempt may be retried only when the governed controller recommends `retry_attempt` and the per-assignment and scheduler limits both permit it. Failed verification follows the same controller decision.

An attempt whose provider effect is not terminally proven is `uncertain`. The runner neither retries it nor finalizes the assignment as failed. A verified `assignment.completion.prepared` gap likewise stops at `completion_reconciliation_required`; the existing exact reconciliation plan/apply route owns recovery. Lease expiry alone never proves provider termination or permits replay of uncertain work.

## Result, events, and privacy

`UnattendedSchedulerResultV1` is a bounded process result containing status, reason, opaque scheduler session, start and finish times, limit values, counters, and the last content-addressed selection. It excludes acceptance criteria, prompts, provider output, repository paths, credentials, reasoning, and arbitrary errors. It is not a canonical event or durable scheduler log.

No new event type is introduced. Successful claims retain `assignment.claimed`; managed attempts retain their causal, adapter, resource, stage, verification, and terminal events; assignment completion retains prepared evidence plus the workforce completion event. Missing events retain their existing failure meaning.

## References

- [ADR-0379](../../decisions/execution/orchestration/governed-work/0379-install-bounded-unattended-assignment-scheduling.md)
- [Headless governed loop](../../decisions/execution/orchestration/governed-work/0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Assignment authority and cancellation](../../decisions/execution/orchestration/governed-work/0337-bind-assignment-approval-and-cancellation-authority.md)
- [Prepared completion reconciliation](../../decisions/execution/orchestration/governed-work/0338-reconcile-prepared-managed-assignment-completion.md)
- [Managed execution budgets](resource-and-performance-budgets.md)
