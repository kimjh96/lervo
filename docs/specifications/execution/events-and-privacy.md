# Execution events and privacy

Status: `active`
As of: 2026-09-01

This specification defines event evidence and privacy guarantees for the [execution specification](../execution.md). Events use schema allowlists and a validated hash chain. Every event and state defines its name and version, identifiers and hashes, privacy, success, and failure or retry meaning. Payloads exclude raw prompts, document bodies, provider output, credentials, absolute paths, reviewer identities, and unrestricted errors.

## Contracts

- [Event envelope compatibility](events-and-privacy/event-envelope-compatibility.md)
- [Workforce events](events-and-privacy/workforce-events.md)
- [Agent workspace and capability events](events-and-privacy/agent-workspace-events.md)
- [Knowledge and terminal integration](events-and-privacy/knowledge-and-terminal-integration.md)
- [Terminal observations](events-and-privacy/terminal-observations.md)
- [Workstreams and coverage](events-and-privacy/workstreams-and-coverage.md)

## References

- [Execution specification](../execution.md)
- [Stage observation and performance](stage-observation-and-performance.md)
- [Additive terminal observation compatibility](../../decisions/execution/providers/0208-additive-terminal-observation-schema-compatibility.md)
- [Conflict-safe repository agent workforce](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Isolated agent workspace lifecycle](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
