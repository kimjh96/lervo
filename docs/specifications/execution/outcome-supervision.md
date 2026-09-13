# Outcome supervision

Status: `designed; implementation required`
As of: 2026-09-11

## User outcome

A user gives a short natural-language goal to a product owner or central coordinator. The accountable owner grounds it in existing knowledge, organizes workers, starts authorized work, handles failures, reviews artifacts, and returns a useful result without repeated user prompts. A tentative idea does not silently authorize implementation. Clear execution requests proceed within authority; consequential ambiguity produces one bounded decision while independent work continues.

This design extends workstreams, agents, assignments, handoffs, governed execution, verification, and resource accounting. It creates no second goal, task, memory, or conversation authority. Proposed contracts are not installed capabilities. See [ADR-0398](../../decisions/execution/orchestration/governed-work/0398-outcome-supervision-and-autonomous-team-allocation.md).

## Design and delivery

- [Responsibility, authority, and workforce decisions](outcome-supervision/ownership.md)
- [Execution and completion](outcome-supervision/execution.md)
- [Contextual user communication](outcome-supervision/communication.md)
- [Implemented controller and composition boundary](outcome-supervision/implementation.md): available APIs, adapter obligations, and remaining installation work.
- [Admission, events, recovery, and compatibility](outcome-supervision/contracts.md)
- [Implementation sequence and installed acceptance](../../roadmap/product-outcome-convergence/execution/outcome-supervision.md)

Wakeups compose with [Node idle reconciliation](../coordination/node-idle-reconciliation.md). Channel membership, mentions, vendor protocols, and bot identities stay in adapters. Local CLI and a non-chat host must use the same ownership and recovery contracts without a Hub.
