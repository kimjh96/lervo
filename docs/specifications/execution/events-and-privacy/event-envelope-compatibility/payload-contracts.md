# Version 2 payload contracts

Envelope version 2 defines readable payload contracts. FH1 emits the causal contract, FH2 emits managed resource observations, and FH3 emits bounded managed and direct-terminal stage observations. Root-agent liveness later adds a fourth v2-only contract without changing the immutable v1 type catalog.

All contracts follow the [validation and evidence boundaries](validation-and-evidence.md):

- [`conversation.repository_work.completed`](payload-contracts/repository-work-completed.md)
- [`agent.liveness.observed`](payload-contracts/agent-liveness-observed.md)
- [`work.causality.recorded`](payload-contracts/work-causality-recorded.md)
- [`resource.usage.recorded`](payload-contracts/resource-usage-recorded.md)
- [`execution.stages.observed`](payload-contracts/execution-stages-observed.md)
