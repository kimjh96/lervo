# Automatic topology supersession

Automatic topology provides a fenced supersession path. A changed-source decision can close only after fresh inspection under the assignment-graph lock proves both the assignment and its creation event absent.

A bounded CAS inspection and `work.supervision.decision.superseded` event preserve the plan and replacement-source binding. Canonical recovery verifies the inspection artifact before skipping the old decision.

Already materialized work, confirmed effects, conflicting observations, owner-fence loss, and stale inspection never authorize supersession. Other effect kinds return `pending_decision_requires_reconciliation` unless their concrete adapters implement an equivalent fenced path.
