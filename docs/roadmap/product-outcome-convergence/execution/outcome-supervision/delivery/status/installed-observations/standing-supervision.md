# Restart, service activation, and standing supervision

## Restart and requirement changes

A deterministic stop between `work.supervision.workspace.prepared` and dispatch resumed with one dispatch and no duplicate allocation, claim, workspace, or hire (WSL 14587–14732). A `SIGKILL` one second after a claim was reconciled on automatic restart.

A requirement change while an unstarted assignment held a live lease did not reach amendment: the owner continued the lease, and the goal was accepted against pre-change criteria (14890–14923).

When the claim lease expired before the owner resumed, the same change reached a versioned amendment (`assignment.amended` 14997), successor claim, review-driven rework, accepted second attempt (15237), and completion (15270). Scenario 9 is observed installed for expired unstarted leases.

Revision `ae18dfa9` makes Node refuse to prepare or dispatch a responsibility bound under an earlier goal revision and list it to the owner. On that bundle, a live-lease change escalated as `goal_revised_lease_pending`, was amended after expiry (15374), reworked once, and independently accepted (15614), with no stale workspace or dispatch.

Revision `f174370d` makes completed locally bound goals report `local_result_canonical`; previously they reported `owner_plan_unavailable` attention because nothing was publishable. A graceful stop immediately after a claim leaves a prepared checkout; amendment now retains it when Node proves it unstarted.

## Scoped service activation

Following these observations, the service was enabled for boot and tested through a controlled WSL restart. All nine Lervo units ran within ten seconds of guest boot; the scoped Node reached ready sync and conversation health on Node bundle `b3a30054`.

The fifteenth goal exposed a capacity fault: the repository crossed the 8,192-event complete execution-event source cap, causing every owner cycle and Node startup to fail closed. It remained invisible until revision `fd6cf5e5` added bounded cycle-failure logging. ADR-0403 raises the cap to 32,768; Node and CLI bundles were redeployed together.

Remaining follow-ups: a reviewed execution-event source compaction design, the idle scoped Node's 0.1-core usage, and two time-dependent `supervision-native-completion` fixtures.

## Standing supervision

ADR-0405 replaces the one-mandate-per-goal transition with a reviewed standing grant. A root mandate with `successorAuthority` lets the installed owner start a successor goal and derive its mandate for each bound request. The scoped service follows verified lineage without restarting.

The installed standing lineage started its first successor goal from a local request without an operator step. That goal exposed a stalled rework claim. ADR-0406 introduced claim supersession, a thirty-second admission margin, and a ten-minute completion floor. The corrected bundle's first cycle reconciled the claim in production.

A separately current workstream previously made the pinned standing owner log `cycle_error_unclassified` every five seconds. Source now types it as `supervision_workstream_inactive`; the installed service treats it as dormant pending lineage evidence, retains event-driven wakeup, and limits fallback checks to once per minute without false unavailable health.

Remaining follow-ups: bounded assignment failure for a successor responsibility whose window elapsed before its claim, and Discord `/goal` proof of consecutive successor goals. The latter needs the operator's Discord session.
