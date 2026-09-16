# Installed observations and remaining work

The [implementation status](../status.md) defines the completion boundary and links the evidence and decisions supporting these observations. Implemented or observed behavior does not by itself close the full installed acceptance gate.

## Natural goal-intent migration

ADR-0410 replaces the guild `/goal` entrypoint with an ordinary managed conversation turn and its `supervision_goal_request` effect. Source fixtures distinguish this from one bounded `repository_work` task and bind human provenance to both the native inbox and immutable intent row.

Installed evidence must remove the old registered command, classify one unmentioned durable-goal request, bind it through the standing owner, and deliver its independently accepted result. Historical slash-command journeys remain valid admission-writer evidence but do not prove this semantic ingress.

## Central and direct intake

Source code binds one authenticated Discord or local request through the installed owner lease and `work.supervision.bound`, preserves the configured product owner after a separately deployed hire, and reads a request-bound result origin.

Installed central/direct journeys bound one central guild `/goal` and one identical local stdin request on successive goals into the same owner, worker, verification suite, and independent review. The central result reached its channel while the central speaker remained silent. A concurrent direct request on an active goal was refused without writing.

Two refused Discord requests were incorrectly acknowledged as connected: intake refusal reached the command handler as an ordinary response failure, and the 30-second fence deadline expired during an owner cycle. Revision `8a673eb2` types refusals, repeats only the recorded per-event outcome, and waits 120 seconds on the Discord path.

On the corrected bundle, the same request reached a second Discord recipient through its own reviewed goal (bound 13982, delivered 14202). A Discord request against a goal already working its local request was refused as `owner_busy`, without binding or a connected claim. Installed `origin_conflict` wording was then observed on the fourteenth goal by sending the Discord request before the first owner cycle.

## Permission recovery and resumed execution

Source classifies operating-system permission denial separately from a missing executable, records `work.supervision.readiness.failed` once per failed-check set without changing the task source digest, exposes bounded attention reason codes in supervision health, and resumes the admitted decision after repair. Disposable Mac fixtures prove this behavior.

The installed WSL journey recorded six safe non-start events and one resumed dispatch after host repair. It also showed that CLI, Node, and Hub readers must share this revision.

Successive installed goals isolated managed-worker defects: an unrenewed assignment lease aborted the first resumed run during verification; late dispatches lacked pre-launch renewal; and renewal advanced the pinned assignment revision.

On corrected bundles, the fourth goal retained one recorded dispatch decision and one failure record across blocked cycles. After repair, the same decision renewed its lease, ran the Codex worker, passed pinned research verification, and received an accepted independent review. Bounded preflight and managed-abort cause codes support later diagnosis.

The owner escalated instead of completing because the goal named recovery itself as acceptance criteria, which canonical owner facts do not expose. The goal was narrowed to the research outcome for completion.

## Local and Discord equivalence

Broader installed equivalence remains to be established beyond one bounded read-only research pair, including worker permission recovery, central/direct handoff, restart, and changed requirements.

The local research goal and a distinct authenticated guild `/goal` successor are accepted and completed; the Discord result has a native transport receipt. An earlier successor's accepted text retained a stale pre-delivery status sentence. A later authenticated guild `/goal` journey delivered a time-stable answer on its first attempt (WSL 13280–13501), proving that instruction installed.

WSL goals 13502–14202 demonstrate central/direct intake into one owner and assignment set, a second recipient through a separate reviewed goal, and a bounded local/Discord equivalence triple. Source, verification, review, and delivery were equivalent; the worker's interpretive pairing varied once.

## Restart and requirement changes

A deterministic stop between `work.supervision.workspace.prepared` and dispatch resumed with one dispatch and no duplicate allocation, claim, workspace, or hire (WSL 14587–14732). A `SIGKILL` one second after a claim was reconciled on automatic restart.

A requirement change while an unstarted assignment held a live lease did not reach amendment: the owner continued the lease, and the goal was accepted against pre-change criteria (14890–14923).

When the claim lease expired before the owner resumed, the same change reached a versioned amendment (`assignment.amended` 14997), successor claim, review-driven rework, accepted second attempt (15237), and completion (15270). Scenario 9 is therefore observed installed for expired unstarted leases.

Revision `ae18dfa9` makes the Node refuse to prepare or dispatch a responsibility bound under an earlier goal revision and list it to the owner. On that bundle, a live-lease change escalated as `goal_revised_lease_pending`, was amended after expiry (15374), reworked once, and independently accepted (15614), with no stale workspace or dispatch.

Revision `f174370d` makes completed locally bound goals report `local_result_canonical`. They previously reported `owner_plan_unavailable` attention because nothing was publishable. A graceful stop immediately after a claim leaves a prepared checkout; amendment now retains it when the Node proves it unstarted.

## Scoped service activation

Following these installed observations, the service was enabled for boot and tested through a controlled WSL restart. All nine Lervo units were running within ten seconds of guest boot; the scoped Node reached ready sync and conversation health on Node bundle `b3a30054`.

The fifteenth goal had exposed a capacity fault: the repository crossed the 8,192-event complete execution-event source cap, causing every owner cycle and Node startup to fail closed. The failure remained invisible until revision `fd6cf5e5` added bounded cycle-failure logging. ADR-0403 raises the cap to 32,768; Node and CLI bundles were redeployed together.

Remaining follow-ups are a reviewed execution-event source compaction design, the idle scoped Node's 0.1-core usage, and two time-dependent `supervision-native-completion` fixtures.

## Standing supervision

ADR-0405 replaces the one-mandate-per-goal transition with a reviewed standing grant. A root mandate with `successorAuthority` lets the installed owner start a successor goal and derive its mandate for each bound request. The scoped service follows verified lineage without restarting.

The installed standing lineage started its first successor goal from a local request without an operator step. That goal exposed a stalled rework claim. ADR-0406 introduced claim supersession, a thirty-second admission margin, and a ten-minute completion floor; the corrected bundle's first cycle reconciled the claim in production.

Remaining follow-ups are bounded assignment failure for a successor responsibility whose window elapsed before its claim, and Discord `/goal` proof of consecutive successor goals. The latter needs the operator's Discord session.

## Unqueued publication recovery

The standing Lervo goal completed at revision 4, then a deployment stopped after admitting `publish_result` and before queueing its outbound. A repository-knowledge migration advanced the task source and exposed `pending_decision_requires_reconciliation`; restart alone could not settle the decision.

ADR-0416 adds queue-absence supersession for this exact pre-transport boundary. Installed acceptance requires the upgraded Node to record one version-8 absence-backed supersession, make a fresh publication decision without rerunning accepted worker work, and return supervision health to ready. Any existing queue event, transport observation, stale inspection, or lost owner fence must fail closed.
