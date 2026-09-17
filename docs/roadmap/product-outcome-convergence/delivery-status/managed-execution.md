# Managed execution and product-host protocols

Managed provider execution enforces exact total, input, cached-input, output, reasoning-output, and per-run stage-duration budgets without estimating unmanaged whole-request usage. See [managed execution resource budgets v1](../../../evidence/foundation/managed-execution-resource-budgets-v1.md).

Product-host protocol v4 installs reviewed direct-message triggering and explicit handoff acknowledgment. It separates reviewed input, routing, delivery, acknowledgment, action, and provider execution without claiming a live external message receiver.

Product-host protocol v5 installs bounded unattended scheduling. One foreground invocation can poll, exact-revision claim, managed-execute, verify, and complete queued assignments while preserving current checkpoints, resource budgets, leases, retry limits, cancellation and approval boundaries, fail-closed uncertain effects, escalation, and a repository-local kill switch.

Graph v2 and product-host protocol v6 implement bounded dynamic graph branches, joins, reviewed topology changes, migration, recovery, historical replay, and installed dependency-ordered execution.

Provider-native session memory and direct unmanaged whole-task token accounting remain `external dependency`; neither blocks implemented portable checkpoint-resume and managed-resource outcomes. The Discord-visible reference product and future first-party interactive surface are `delivery required` under [ADR-0417](../../../decisions/execution/applications/0417-own-discord-visible-reference-product.md). Future product-host routes require packed external-consumer proof and shared host conformance.
