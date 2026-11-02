# ADR-0589: Shorten the follower path from publication to the last repository

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0575](0575-follow-published-releases-on-every-host.md) (a pass that installs no release yields to a newer one, a block on owner approval with nothing else to apply waits for another CLI, and owner-approval blocks run last), [ADR-0582](0582-reuse-one-repository-scan-across-an-upgrade-command.md) (the follower also skips a `--safe` fallback that the changed-plan refusal shows would refuse), [ADR-0547](../knowledge/repository/layout/0547-block-only-layout-overflow-a-write-creates-or-grows.md) (lint is skipped when an apply changed nothing before it and knowledge is current with no background debt)
Amended by: [ADR-0561](../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) (an owner-approval block becomes `upgrade_lervo_debt`, which still runs last but keeps the hourly recheck; the exact `--approval` apply and the `--safe` fallback are gone)
Related: [ADR-0579](0579-describe-the-bundled-node-runtime-once-per-upgrade-and-time-its-stages.md) (the `stageTimings` this decision reads and extends), [ADR-0487](../operations/services/0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md) (`--safe` and the changed-plan refusal), [ADR-0559](../knowledge/documents/routing/0559-ask-one-owner-decision-for-a-reviewed-layout-plan.md) (a layout decision binds exact source bytes)

## Context

The owner's target is a published release on every repository of the Mac in under 15 minutes. v0.25.5 was published at 03:33:20 UTC on 2026-11-18, and the Mac follower finished its release pass at 04:18:22, 45 minutes later. The evidence comes from the Mac follower's `host-follow.json`, `host-follow.log`, and argo's presented plan, read without changes.

### A. The release waited 14 minutes for a retry pass and a poll

The log shows a `repositories_retried` cycle at 03:42:18 and the `upgraded` cycle at 04:18:22. The retry pass was rechecking axli-lab and argo, both blocked with `upgrade_owner_approval_required`. It was running at publication and ended 9 minutes later. The repository entries of the release pass add up to 1,867 seconds, so that pass started at about 03:47:15, at the next poll.

The follower checked for a release only at the start of a cycle. A retry pass had no way to stop for a release, and a cycle that ended never looked again before its 5-minute sleep.

### B. argo spent 932 seconds, 564 of them unrecorded

argo's entry ends `blocked` with `upgrade_owner_approval_required`, status `ready`, and one stage timing: `plan_command`, 368,576 ms. `elapsedMs` is 932,383. The presented plan, written at 04:07 UTC, explains the status. Its knowledge stage was `pending_authority` (`layout_decision_pending`), and its Node stage was `safe_apply`, so the plan was `ready`.

The code accounts for the other 563,807 ms. Only `--safe` reports `upgrade_owner_approval_required`, and the follower runs `--safe` after a `ready` plan only when the exact apply failed with `upgrade_plan_changed`. So two applies ran. Each one waited for the host's full-cycle admission and planned again inside it, and each was refused. A refusal carries no receipt, so neither command recorded a timing.

Why the plan changed between the plan command and the apply was not observed. During that window, the argo checkout shows writes to terminal hook state, instruction capture, and the resident cycle record. A layout decision binds the exact source bytes, so an edit made by the owner's session changes the plan ID. This is a likely cause, not a measured one.

The `--safe` fallback could only refuse, because the knowledge stage still waited for the owner. The hourly recheck takes the same path while the owner's decision is pending, on a Mac with a load of about 20.

### C. axli planned the repository about five times

axli's entry recorded these parts:

| Part                                          | Time  |
| --------------------------------------------- | ----- |
| `plan_command` (the plan-only child process)  | 90 s  |
| `plan` (the plan recreated inside the window) | 135 s |
| `knowledge` (one inspection, nothing applied) | 96 s  |
| `knowledge_lint`                              | 98 s  |
| `final_plan`                                  | 92 s  |
| `replica_service`                             | 60 s  |

Measured from the code, a repository that needs an apply runs one full plan in the plan command and one in the window. Each full plan runs every stage inspection. The apply then inspects knowledge again before each knowledge step and runs knowledge lint. The final plan repeats every inspection. Knowledge inspection runs four times per repository, and lint once. ADR-0582 shares the scan across one command, but not the rest of an inspection, and not across the two processes. axli's parts stayed between 90 and 135 seconds, so most of each part on axli was work the scan reuse does not cover, or its scan was not reused. The timings cannot tell which. axli applied only `host_service` and `replica_service`, both after lint.

## Decision

### A pass that installs no release yields to a newer release

A retry pass, and a pass for a CLI that no follower activation owns, ask between repositories whether a newer release is installable. The answer is the tag the poll would install: the newest published release newer than the active CLI, not failed on this host, and allowed by the pin. A pause set during the pass answers no. When the answer is a tag, the pass stops at that boundary.

- A stopped retry pass merges the results it has into `lastPass`. The repositories it did not reach keep their due entries.
- A stopped pass for an unowned CLI is not recorded. It is due again if the release never becomes active.
- A release pass and the converging pass after a rollback never yield, because each one settles an activation.
- A running `lervo upgrade` is never stopped for a release. The boundary is between repositories.

A tag that the last cycle tried to install and left held is not yielded to. Held means `waiting`, `host_blocked`, `busy`, `install_retry`, or `install_abandoned`. Such an outcome does not fail the tag, so yielding to it could stop a pass at the same boundary every cycle, and the later repositories would never run. The poll installs that tag instead.

Listing releases is bounded. The check reuses the cycle's own listing and lists again at most once per boundary, and never within 60 seconds of the previous listing (`FOLLOW_PASS_RELEASE_CHECK_MS`). A pass of many short repositories therefore costs about one GitHub request a minute. A failed listing means no release is known yet; it is not counted as a source failure.

### A newer release is installed in the same cycle

When a pass that installs no release ends, whether it stopped early or not, the follower checks once more. It installs a known newer release in the same cycle, instead of sleeping until the next poll. A pass that was interrupted, or that must hand over, ends the cycle as before.

The cycle result gains `precededBy`: `{ outcome, yielded }`, where `outcome` is `repositories_retried` or `repositories_upgraded`, and `yielded` is true when the release stopped that pass at a boundary. It is null for any other cycle. The `--once` JSON carries it, and the service log line carries it only when it is set.

### A block on owner approval stops costing three plans

- A repository that ends `blocked` with `upgrade_owner_approval_required` and a plan that is not `ready` gets no hourly recheck with the same CLI. Only stages that wait for the owner are left, and the follower can never apply them. The owner's own command lifts the block: `--accept-layout` for a layout decision, or `--approval` for the plan. The next CLI plans the repository again, and so does a pass for an unowned CLI. An approval given elsewhere, such as through a Hub, is therefore picked up at the next release, not within the hour.
- A `ready` plan blocked the same way keeps the hourly recheck. It still has a stage the follower can apply, such as argo's Node stage, and a recheck applies it once the plan holds still between the plan command and the exact apply. The recheck also notices an approval given elsewhere, such as through a Hub. Other blocks keep the hourly recheck too, because the knowledge resident can resolve them.
- Every pass runs the repositories that the last pass left waiting for an owner approval after all the others. Their time no longer delays a repository the release can reach.
- The `upgrade_plan_changed` refusal names `ownerApprovalStages`, the stages of the plan it recreated that wait for an owner approval. When that list is not empty, `--safe` would refuse before any write, so the follower records `upgrade_owner_approval_required` with those stages in `pendingStages` and runs no `--safe` apply. An earlier CLI's refusal carries no list, and the follower keeps the `--safe` fallback for it.
- A `--safe` refusal already listed its stages in `stages`; the follower now records them in `pendingStages` too.

For argo on v0.25.5, an attempt becomes the plan command and one exact apply, two plans instead of three. Once its Node stage applies, the plan is no longer `ready`, and the hourly recheck stops until the next CLI.

### Time without a receipt is recorded

An apply that returns no receipt parts is recorded as one part of its own: `apply_command` for `--apply --approval`, and `safe_apply_command` for `--apply --safe`. This covers a refusal, a failure, an unreadable run, a timeout, and a receipt from a CLI earlier than ADR-0579. The parts of a pass entry now cover every child command it ran.

### Lint is skipped when the apply changed nothing and knowledge is current

`lervo upgrade --apply` skips knowledge lint when, at that point, it has applied no stage and its own knowledge inspection found the stage `current` for a reason other than `background_owned`. The receipt then has `knowledgeLint: null` and the skipped stage `knowledge_lint` with reason `knowledge_current_nothing_applied`. The `knowledge_lint` part stays in `stageTimings`, with the near-zero time of the skip.

In every other case lint runs as ADR-0547 decided. That includes an apply that wrote any stage before lint, and a knowledge stage that is blocked, pending, or deferred. It also includes a `current` stage with reason `background_owned`: the resident still owns normalization debt there, and the receipt's "knowledge lint: N issue(s)" warning is how the owner sees that content. Lint writes nothing and gates nothing in an upgrade; it reports repository content. With no change from the run and knowledge current with no debt left, it would repeat the report that the knowledge resident and `lervo knowledge lint` already give.

### Not chosen

- **Skipping `final_plan`.** The receipt's `status`, `nextPlanId`, and `pending` must come from an observation after the last write. The event writer, the services, and edits by the owner can change knowledge inputs after the knowledge step. No stage proves its own post-state today. A receipt that reused the earlier inspection would claim `current` without proof.
- **Sharing a fingerprint between the plan command and the apply.** The plan reads more than the scan, so a fingerprint persisted across processes must cover every input, or the apply could skip a stage that changed. Follow-up 1.
- **Using the receipt's `nextPlanId` for the next round.** This is exact, because the apply still re-plans inside the window, and saves one plan per extra round. Follow-up 2.
- **Stopping a running repository upgrade, or a release pass, for a newer release.** Stopping an apply between its stages leaves recovery work. A release pass settles an activation.

## States, privacy, and failure meaning

- `precededBy` is a cycle result field, not state, with no path or GitHub output.
- `apply_command` and `safe_apply_command` are new `stage` values in a pass entry's `stageTimings` in `host-follow.json`. Each holds `round`, `stage`, and `ms`, as other parts do.
- `ownerApprovalStages` is a new detail of the `upgrade_plan_changed` JSON error. It lists stage names only.
- `knowledge_current_nothing_applied` is a new skip reason for `knowledge_lint` in the receipt. `knowledgeLint` is then null, meaning lint did not run, never that it passed.
- A repository that ends `blocked` with `upgrade_owner_approval_required` and a status other than `ready` has `nextAttemptAt` null. It means the follower waits for another CLI or for the owner's own `lervo upgrade`.
- No event, file, or column is added.

## Consequences

The estimates below are not measured. They replay v0.25.5 with this decision.

- **A.** axli-lab, whose plan was not `ready`, would no longer be rechecked. argo's plan was `ready`, so its recheck was still running at publication. Without the `--safe` apply it would have ended about 5 minutes sooner, at about 03:37:40. The install would then start at once instead of at the next poll, about 4 minutes after publication instead of 14. With no retry pass running, the release pass starts at the first poll, at most 6 minutes with jitter.
- **B.** argo drops from 932 seconds to about 650. The plan command still takes 368 seconds, and one exact apply takes about half of the 564 seconds that went unrecorded. argo and axli-lab run last, so on v0.25.5 flemo, digimon, shiflo, and lervo would have finished about 15 minutes earlier. argo's hourly recheck drops from three plans to two, and it stops once Node applies.
- **C.** axli drops by about 98 seconds of lint.
- Together: the six repositories that can reach the release finish about 14 to 20 minutes after publication on a Mac loaded like this one, against 45. axli alone is about 11 of those minutes. The 15-minute target is not met under that load until axli's inspections get cheaper.

Follow-ups, each with its own verification:

1. Persist one verified input fingerprint from the plan command and let the apply's in-window plan reuse the stages whose inputs are unchanged. The fingerprint must cover the scan, the event-store high-water mark, the Node registry, service definitions, and capability and workforce state. A test must show that a change to each input between the two processes still produces `upgrade_plan_changed` or `knowledge_plan_stale`.
2. Report `applicableStages` and owner-approval stages in the receipt, and apply the next round by its `nextPlanId` without another plan command. A test must show that a moved plan is still refused inside the window.
3. Profile one axli inspection on the Mac when the owner allows it, to split scan, evidence collection, and structural planning time.

## Verification

GitHub CI runs these tests. They were not run locally: the Mac stays read-only while the owner works, and WSL was not used. Each test below fails on origin/main.

- `host-repository-pass.test.ts`: an argo-shaped run ends `blocked` after two commands, with `apply_command` timed. A refusal that names no stage still falls back to `--safe`, and both applies are timed. A pass stops where `yieldToRelease` answers true. The runner reads `ownerApprovalStages` from both refusals.
- `host-follow-cycle.test.ts`: a retry pass stops after its first repository when a release appears two minutes in, and the same cycle installs that release and upgrades both repositories with it. A `ready` owner-blocked repository is rechecked an hour later and applies Node once the plan holds. A pass does not yield to a tag left `waiting`.
- `host-follow-release-watch.test.ts`: the cycle's listing is reused for 60 seconds, and then one listing finds the new release. A failed tag, a pin, a pause, a failed listing, and a held tag each answer correctly.
- `host-follow-policy.test.ts`: an owner-approval block that is not `ready` gets no recheck, while a `ready` one and a content block keep the hourly one. Repositories waiting for an owner approval run last.
- `host-follow-command.test.ts`: the first follow cycle yields to the newer release and reports `precededBy`.
- `upgrade-safe-apply.test.ts`: the `upgrade_plan_changed` refusal carries `ownerApprovalStages`.
- `upgrade-stage-policy.test.ts`: lint is skipped only when nothing was applied and knowledge is `current`; a blocked, pending, deferred, applicable, or `background_owned` knowledge stage is still linted.

Installed verification: the next Mac follower pass after this release reports its start time, argo's `apply_command`, and axli's skipped lint in the [release-to-fleet roadmap](../../roadmap/operations/release-to-fleet.md).
