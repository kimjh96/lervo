# Managed runs and materialization

[ADR-0444](../../../../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md) requires:

- Managed provider runs hold a shared repository source lease from admission through settlement.
- Durable knowledge apply and recovery hold an exclusive lease around the complete journal and event effect.
- Concurrent turns may read together; knowledge writers use bounded retry scheduling while a turn is active.
- Busy or invalid managed admission fails the existing repository snapshot stage before provider start.
- An interrupted materialization journal blocks new managed reads until recovery.

When an active knowledge materialization transaction causes the knowledge index to return `knowledge_recovery_required`, a managed conversation read records and uses only its operational repository search attempt. That turn emits no knowledge attempt, knowledge recommendation, relation projection, or currency claim. Other knowledge-source failures still fail closed. This fallback neither settles nor recovers the background transaction; the owner retains that obligation.
