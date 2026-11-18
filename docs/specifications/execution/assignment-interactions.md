# Assignment interactions and acknowledgment

Status: `active`
As of: 2026-11-02

## Scope

This specification defines handoff recording and explicit handoff acknowledgment. It adds no chat database, task store, provider invocation, external delivery, or approval authority. The current workforce assignment, `assignment.handoff.recorded`, and explicit `assignment.handoff.acknowledged` remain canonical.

`lervo assignment handoff` records a handoff through the workforce transition, which validates both role contracts, the source lease, recipient role policy, state revision, and state/event commit boundary. `assignment.handoff.recorded` is route-success evidence. [ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the mention-route, reviewed direct-message trigger, and connector delivery entrypoints. Stored handoffs that carry their trigger provenance stay readable.

## Removed thread and inbox projection

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) also removed the assignment thread and inbox projection, `lervo loop thread`, `lervo loop inbox`, and the local operating board. They had no production invoker. Handoff and acknowledgment state and events stay canonical and readable.

## Explicit acknowledgment

`lervo assignment acknowledge` requires the exact assignment, handoff, active recipient-agent coordinate, and `--write`. It revalidates that agent's current role contract, rejects a different agent coordinate, and atomically records `acknowledgedAt` with `assignment.handoff.acknowledged`. The local CLI does not authenticate a human principal; hosts must add that boundary before mapping an external actor to the agent coordinate. Exact replay is current and emits no second event.

Acknowledgment proves only that the exact recipient-agent coordinate was explicitly supplied to the acknowledgment transition. It proves neither human identity, delivery, understanding, task acceptance, lease acquisition, action, review, verification, nor completion.

`assignment.handoff.acknowledged` requires assignment ID, handoff ID, recipient agent ID, acknowledgment time, and resulting assignment revision. State and event commit together; event-append failure restores the prior assignment bytes.

## Privacy and failure meaning

Events exclude message, task, and acceptance bodies; repository paths; prompts; provider output; reasoning; credentials; actor prose; and reversible external platform identifiers. Message or request material remains in separately governed content-addressed artifacts.

Route recording proves only that the handoff state and event committed. A failed transition records no route. Missing delivery or acknowledgment evidence remains unobserved, never success, failure, zero, or negative acknowledgment.

## Required verification

Focused tests cover recipient-coordinate acknowledgment, event rollback, privacy allowlists, and no delivery or acknowledgment inference.

## References

- [Execution and evidence specification](../execution.md)
- [Execution events and privacy](events-and-privacy.md)
- [ADR-0342](../../decisions/execution/orchestration/governed-work/0342-project-assignment-interactions-from-workforce-handoffs.md)
- [ADR-0375](../../decisions/execution/orchestration/governed-work/0375-route-reviewed-direct-messages-and-record-explicit-handoff-acknowledgment.md)
