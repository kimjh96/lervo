# Transition guards and recovery

For a configured supervised Node, `service:manage --action upgrade` and `rollback` acquire the repository supervision owner fence before stopping the old unit. Under [ADR-0164](../../../../../../decisions/operations/services/0164-user-runtime-service-management-boundary.md), a busy supervision lease is retried for up to 15 minutes while a cycle settles. `service_upgrade_supervision_busy` means the lease remained busy throughout that wait; the service remains untouched.

Separately, a live admitted-work claim yields `service_upgrade_work_busy` before any stop. Do not infer that this refusal follows the same fifteen-minute wait. Do not stop the unit manually to bypass the fence. This guard does not yet prove that independent conversation turns are drained.

The previous claims of retries every 5 seconds and both busy failures occurring only after the full wait remain unverified: the supplied canonical contract establishes neither the five-second interval nor that timing for admitted-work refusal. They are not operator guarantees.

If an exact installed Node is already inactive after a failed stop, guarded upgrade may recover its previously registered work-admission scope only when the configuration digest still matches and dead-session cleanup leaves no live session or claim. The supervisor fence and exact predecessor checks still apply. A Node with no prior registered scope remains ineligible.
