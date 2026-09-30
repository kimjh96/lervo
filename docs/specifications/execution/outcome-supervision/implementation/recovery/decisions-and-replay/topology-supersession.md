# Automatic topology supersession

Automatic topology provides fenced supersession. A changed-source decision can close only after fresh inspection under the assignment-graph lock proves that both the assignment and its creation event are absent.

A bounded CAS inspection and `work.supervision.decision.superseded` event preserve the plan and replacement-source binding. Canonical recovery verifies the inspection artifact before skipping the old decision.

Already materialized work, confirmed effects, conflicting observations, owner-fence loss, and stale inspection never authorize supersession. Result delivery has an equivalent narrow path only before its deterministic queue event exists; see [independent accepted-result delivery](../../result-delivery.md). Other effect kinds return `pending_decision_requires_reconciliation` unless their concrete adapters implement an equivalent fenced path.
