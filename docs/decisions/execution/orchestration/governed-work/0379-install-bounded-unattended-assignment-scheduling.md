# ADR-0379: Install bounded unattended assignment scheduling

- Status: `accepted`
- Decision date: 2026-09-07

## Context

The governed loop could project claim, start, retry, wait, block, escalation, reconciliation, cancellation, and completion, but each transition required another manual command. Authenticated triggers could materialize assignments but deliberately could not claim or execute them, leaving the accepted autonomous-continuation outcome incomplete.

Polling assignment files and starting a provider directly would duplicate graph policy, weaken exact lease authority, and risk replaying uncertain provider effects. An unbounded daemon or scheduler database would violate local-first and canonical-state boundaries.

## Decision

Add a bounded foreground `lervo loop schedule` application route and product-host protocol v5. One invocation may poll and complete multiple current assignments without repeated manual triggers. Require explicit write authority, provider selection, finite cycle, claim, managed-run, runtime, consecutive-failure, polling, and lease bounds, and an exact repository-relative kill-switch path.

Separate responsibilities:

- `@lervo/application-contract` owns scheduler observation and result shapes.
- `@lervo/work-controller` owns pure deterministic action selection from one governed report plus workforce snapshots.
- Agent workforce retains dependencies, role and capability binding, path conflicts, lease state, atomic claim, events, and rollback. Scheduler claims add an exact expected-revision check.
- The CLI owns the foreground timer, owner-only single-run lock, kill-switch observation, assignment-derived instruction construction, and composition of existing inspection, claim, managed-run, and finalization ports.
- Providers remain behind adapters.

The scheduler may execute only `start_attempt` or `retry_attempt` under a lease carrying its own opaque scheduler session. Select active compatible agents by exact role contract, provider allowance, optional capability hash, all expected paths, and optional explicit agent filters. The existing governed report remains authoritative for priorities, dependencies, approvals, parallel capacity, attempt limits, cancellation, completion, and resource budgets.

Derive managed instructions only from the canonical assignment ID, task type, and acceptance criteria. Pass every exact assignment path and verification suite. Extend the compatible managed-run request with an `expectedPaths` set while retaining the existing single `expectedPath` input.

Known pre-effect admission failures and controller-authorized terminal failures may retry within both attempt and scheduler bounds. An in-progress or completed attempt followed by an unproven application outcome is uncertain: neither retry nor finalize failure. Prepared completion remains owned by the exact existing reconciliation command. Cancellation recommendations stop for attention; they do not grant scheduler cancellation authority. Missing approvals wait only within invocation bounds.

Check the kill switch before observation, claim, and provider start. It pauses future effects without claiming to interrupt a running provider. Adapter deadlines and terminal events remain the only managed process evidence. Reaching an invocation bound pauses without claiming work completion.

Expose the route additively through product-host protocol v5, removing only `unattended_scheduling` from that version's unsupported list. Protocols v1 through v4 remain compatible and continue to declare it unsupported.

## Privacy and failure meaning

The scheduler result contains bounded counters, limits, times, opaque IDs, graph hash, action and reason codes. Exclude prompts, acceptance prose, paths, provider output, credentials, native errors, and reasoning. The scheduler lock and kill-switch entry are local transient controls, not events, work authority, or synchronized state.

- `completed`: the current governed report observed all assignment nodes complete.
- `paused`: a kill switch or configured invocation bound stopped admission.
- `attention_required`: a current governed decision, incompatible workforce, rejected result, budget, cancellation, reconciliation, or execution state prevents autonomous continuation.

A claim race is retryable only because the exact provider effect has not started. Never retry `uncertain` provider effects automatically.

Add no new event. Existing claim, managed-run, resource, stage, completion-preparation, and assignment-completion events preserve their required fields, privacy rules, and failure meanings.

## Consequences

Lervo can drain bounded queued work locally from one explicit invocation without a Hub or repeated manual trigger. Policy, state, provider, timer, and rendering remain independently testable and replaceable. An operating-system service wrapper, remote scheduler, in-flight provider interruption, automatic cancellation, implicit approval, and dynamic graph mutation remain separate future decisions.

## References

- [Bounded unattended assignment scheduling](../../../../specifications/execution/unattended-scheduling.md)
- [Bounded autonomous continuation](../../../../roadmap/product-outcome-convergence/execution/autonomous-continuation.md)
- [ADR-0336](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [ADR-0337](0337-bind-assignment-approval-and-cancellation-authority.md)
- [ADR-0338](0338-reconcile-prepared-managed-assignment-completion.md)
- [ADR-0373](0373-enforce-managed-execution-dimension-and-duration-budgets.md)
