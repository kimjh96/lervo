# Unqueued publication recovery

The standing Lervo goal completed at revision 4. A deployment then stopped after admitting `publish_result` and before queueing its outbound. A repository-knowledge migration advanced the task source and exposed `pending_decision_requires_reconciliation`; restart alone could not settle the decision.

ADR-0416 adds queue-absence supersession for this exact pre-transport boundary. Installed acceptance requires the upgraded Node to record one version-8 absence-backed supersession, make a fresh publication decision without rerunning accepted worker work, and return supervision health to ready.

Any existing queue event, transport observation, stale inspection, or lost owner fence must fail closed.
