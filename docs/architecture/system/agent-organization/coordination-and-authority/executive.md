# Executive coordination and authority

## Decisions and effects

[ADR-0560](../../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the multi-team operating report, the executive policy evaluator, and the organization-executive coordinator with its Discord and repository effect adapters. Executive effects now use the same authority paths as every other agent: assignments, workstreams, approvals, and the Discord runtime's own administration actions.

## CEO authority and evidence

The CEO is the owner's policy-bound operational proxy, not a second owner authority. It may execute shell work and request filesystem mutation, network, messaging, deployment, data mutation, and `computer.use` under their separate approval policies.

Computer use is an explicit capability-package permission. A provider feature name, installed MCP server, or browser tool does not prove that a particular CEO run received or used it. Runtime retains selected, loaded, activated, injected, and used evidence as separate claims.

## Conversation

Ordinary agent conversation remains read-only unless an existing authority path creates or changes an assignment, workstream, approval, or external effect. Bounded discussions reuse Lervo deliberation for evidence, disagreement, decision rules, and termination. Discord supplies distinct visible speakers.
