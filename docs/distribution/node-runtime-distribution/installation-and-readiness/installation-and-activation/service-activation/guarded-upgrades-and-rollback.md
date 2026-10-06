# Guarded upgrades and rollback

For a configured supervised Node, `service:manage --action upgrade` and `rollback` acquire the repository supervision owner fence before stopping the old unit. Under [ADR-0164](../../../../../decisions/operations/services/0164-user-runtime-service-management-boundary.md), a busy supervision lease is retried for up to 15 minutes while a cycle settles. `service_upgrade_supervision_busy` means that lease remained busy for the whole wait, leaving the service untouched. Separately, a live admitted-work claim yields `service_upgrade_work_busy` before any stop. Do not infer that this work-admission failure follows the same fifteen-minute wait. Do not stop the unit manually to bypass the fence. This guard does not yet prove independent conversation turns are drained.

Evidence correction: the previous wording specified retries every 5 seconds and said both busy failures occurred only after the entire wait. The supplied canonical contract does not establish the five-second interval or that timing for admitted-work refusal. Those prior timing statements are retained here only as unverified claims, not operator guarantees.

If an exact installed Node is already inactive after a failed stop, guarded upgrade may recover its previously registered work-admission scope only when the configuration digest still matches and dead-session cleanup leaves no live session or claim. The supervisor fence and exact predecessor checks still apply. A Node with no prior registered scope remains ineligible.

## Pinned deliberation CLI changes

If an existing configuration directly pins an older deliberation CLI, prepare an exact owner-only candidate changing only its `cliExecutable` references. A guarded Node upgrade may add `--configuration-source <candidate.json>` while retaining the running configuration path.

The manager verifies stop before replacing configuration bytes and the frozen admission digest; failure restores both before restarting the predecessor. An unresolved private transition journal requires recovery, not another unchecked attempt. Reader rehearsal must include these pinned CLI entrypoints before enabling a newer event writer.

## Shared Discord channel changes

Alternatively, the same guarded transition may add one already shared Discord channel to one identity, with no other candidate changes. For an organization-bound identity, rebind the durable deployment under the same stopped-service work freeze and restore its predecessor binding on rollback. Preflight the replacement after the rebind and observe the Node's `conversation.status: ready` after activation.
