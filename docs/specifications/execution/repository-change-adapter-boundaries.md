# Repository change adapter boundaries

CLI adapters connect observed repository changes to the background-knowledge source defined by [ADR-0433](../../decisions/knowledge/repository/canonicalization/0433-own-background-knowledge-for-every-repository-change.md). Source-bound review and truthful outcomes follow [ADR-0427](../../decisions/knowledge/repository/canonicalization/0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md).

Adapter contracts:

- [Managed runs](repository-change-adapter-boundaries/managed-runs.md)
- [Terminal turns](repository-change-adapter-boundaries/terminal-turns.md)

## Evidence limits

A stored manifest or append result establishes no worker completion, installed acceptance, canonical-source promotion, or knowledge currency. Planner filtering, overflow handling, append deduplication, and outbox semantics belong to their owning repository-knowledge contracts. Historical missing candidates and limit failures neither establish what earlier repository bytes meant nor prove their obligations are settled.
