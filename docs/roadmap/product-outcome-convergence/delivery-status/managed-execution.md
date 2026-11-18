# Managed execution and product-host protocols

Managed provider execution reports exact total, input, cached-input, output, and reasoning-output usage per accounting group without estimating unmanaged whole-request usage. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the governed-loop token-dimension and stage-duration budgets, the product-host protocol, and bounded unattended scheduling. Outcome supervision keeps its token ceiling.

## Protocol history

- Product-host protocol v4 installed reviewed direct-message triggering and explicit handoff acknowledgment. ADR-0560 removed the trigger route; acknowledgment stays.
- Product-host protocol v5 installed bounded unattended scheduling, later removed by ADR-0560. One foreground invocation can poll, exact-revision claim, managed-execute, verify, and complete queued assignments while preserving current checkpoints, resource budgets, leases, retry limits, cancellation and approval boundaries, fail-closed uncertain effects, escalation, and a repository-local kill switch.
- Graph v2 and product-host protocol v6 implemented bounded dynamic graph branches, joins, reviewed topology changes, migration, recovery, historical replay, and installed dependency-ordered execution. ADR-0560 removed the manual topology route; automatic supervision topology keeps the graph v2 contract.

## Dependencies and delivery boundaries

Provider-native session memory and direct unmanaged whole-task token accounting remain `external dependency`; neither blocks implemented portable checkpoint-resume and managed-resource outcomes.

The Discord-visible reference product and future first-party interactive surface are `delivery required` under [ADR-0417](../../../decisions/execution/applications/0417-own-discord-visible-reference-product.md). A future host boundary requires a new decision, packed external-consumer proof, and shared host conformance.
