# ADR-0398: Outcome supervision and autonomous team allocation

Status: `accepted design; implementation pending`
Decision date: 2026-09-11

## Context

Observed product-owner conversations recorded scope, sent instructions, and confirmed delivery while workers could not start. The human corrected responsibility allocation and discovered a provider failure. Existing identities, handoffs, inboxes, native execution, and scheduling did not close the outcome loop.

Owners must autonomously reuse staff, hire appropriately, and define worker responsibilities. Central leadership coordinates teams without duplicating ownership. Contracts must remain independent of Buzz, Discord, provider brands, and named agents, and compose with concurrent idle reconciliation.

## Decision

Adopt [outcome supervision](../../../../specifications/execution/outcome-supervision.md) over canonical workstreams and assignments. Bind one accountable owner, exact worker responsibilities, and terminal evidence to the next owner decision. Distinguish delivery, acknowledgment, start, verification, acceptance, and user publication.

Allow autonomous allocation and exact plan review within a versioned operating mandate. Require a new policy-review mode; topology v2's current manual review remains unchanged until implementation. Roles are templates; responsibility revisions preserve capability ancestry, budgets, and leases. Owners retain acceptance responsibility.

Route wakeups through durable causal relationships and deadlines, composing with ADR-0397. Failure reaches the owner without requiring a chat reply or mention. Cross-team escalation retains repository authority and successor acceptance.

## Alternatives and consequences

Stronger prompts cannot repair missing capabilities or terminal-result routing. Unconditional bot replies risk loops and duplicate work. A chat-centric task database duplicates authority. An always-running model adds idle cost without establishing progress.

The design reuses infrastructure while adding explicit admission, responsibility, review, and recovery evidence. It requires versioned contracts and installed acceptance; this document does not activate autonomy.

## Delivery and references

- [Contract details](../../../../specifications/execution/outcome-supervision/contracts.md): proposed events, states, privacy, failures, bounds, and compatibility.
- [Delivery roadmap](../../../../roadmap/product-outcome-convergence/execution/outcome-supervision.md): sequence and installed acceptance.
- Operating goal specification, removed by [ADR-0560](../../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md).
- [Assignment interactions](../../../../specifications/execution/assignment-interactions.md).
- [Dynamic topology](../../../../specifications/execution/dynamic-assignment-topology.md).
- [Organization](../../../../architecture/system/agent-organization.md).
- [Node idle reconciliation](../../../../specifications/coordination/node-idle-reconciliation.md).
