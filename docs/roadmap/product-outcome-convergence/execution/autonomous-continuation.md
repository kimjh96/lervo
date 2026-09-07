# Bounded autonomous continuation

State: `implemented`

Outcome: bounded autonomous continuation runs without repeated manual triggers.

Evidence: one installed `lervo loop schedule` invocation discovers, exact-revision claims, managed-executes, verifies, and completes a queued assignment through product-host protocol v5 without a Hub or another manual trigger. See [installed bounded unattended scheduler v1](../../../evidence/foundation/installed-bounded-unattended-scheduler-v1.md).

Acceptance is bounded by current governed checkpoints, exact leases, attempt and invocation limits, provider-reported token and duration budgets, cancellation and approval authority, fail-closed uncertain effects, escalation, and a repository-local kill switch. It does not claim in-flight preemption, an operating-system daemon, implicit approval, or dynamic topology.
