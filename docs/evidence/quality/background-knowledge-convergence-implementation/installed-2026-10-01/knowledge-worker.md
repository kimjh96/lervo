# October 1 knowledge worker and call-budget recovery

## WSL authority and normalization

At 01:13:00 UTC, reviewed WSL successor plan `sha256:09322fef03c5c19dc422e7512d91966177aaaa04d1679eb3f63bd11ccf102f64` applied as `kstruct_575a2b334e1174f2af8d83b1`. The current delegation permits eight documents, eight provider calls, and eight stages under `repository.default.v9`, expiring at 19:00 UTC. This authorizes attempts, not proof of eight-document completion.

Earlier verification `ver_4888ffd4c5224b15` failed isolated workspace preparation: its candidate lockfile lacked the `@lervo/project-storage` workspace dependency present in current source. This integration failure remains historical evidence; recurrence requires source-bearing correction under reviewed authority.

At 01:26 UTC, the worker was running `normalization_review` with 179 normalization and three lifecycle reasons. Normalization apply event 59003 reached `current` at 01:32:36 UTC and queued the next batch. That batch failed at event 59008 with `normalization_budget_exceeded`: preflight estimated 12 provider calls against seven available to the generator after reserving one of the approved eight for review. This is a batch selection limit, not permission to exceed the approved ceiling. Full baseline currency remains unverified.

## Mac resident worker

The Mac resident knowledge worker was upgraded again to the `call-budget-r1` CLI bundle, `sha256:2b112066bed97a550dfd10d05bd26fec06d3a5e888763237cd20e6d036908533`. Launchd reported PID 47021 and the exact new executable path. At 01:57 UTC, the heartbeat was healthy, the stage was `assessment`, and `baselineCurrent` remained false.

Focused tests (13 on Mac, six on WSL), type checking, quality checks, the built CLI smoke check, documentation checks, and the task-base release completion check passed. Release intent remained pending review.

## WSL Node bundle and blocked activation

An isolated WSL worktree built the matching Linux Node distribution after the call-budget source fix, committed there as `7e465ee396a`. Archive `sha256:06fb9dc64d7eadbefe233deac62a505e579879f5400ca2bec76f8a4c70e84dcc` independently verified as 0.18.0 `linux-x64-glibc` with 5,826 entries, then installed at `/home/jonghyeok/.local/lib/lervo-node/call-budget-0.18.0-20261001`.

WSL type checking, six focused tests, quality checks, and release completion with `intent_pending` passed. A canonical service definition and exact predecessor copy were prepared.

Two guarded Node upgrade attempts returned `service_upgrade_supervision_busy`. The installed bundle was not enabled; the previous service remained active with zero restarts. Read-only lock inspection found PID 354 holding the SQLite read and write locks for `supervision.discord.standing.s4`, the current standing binding.

Before any service transition, the worker still reported `normalization_budget_exceeded` and `baselineCurrent: false`. No installed call-budget recovery is claimed.

## Later linked-authority correction

After the call-budget deployment, the guarded WSL r6 Node stayed ready. Its background worker passed canonical integration and three successive normalization apply verifications, with the third recorded at 17:34:19 UTC on October 1. These are source-scoped results; complete baseline currency and a live transient supervision recovery are not observed.

Mac canonical review rejected the PR-template batch again because its bounded context included the newly recorded PR contract but omitted that contract's linked release decision and versioned writing policy. Rejection artifact `sha256:955d06ee57b98ba2123dc727f71c10fd7fbd7f9af5c0f616498366b870b99918` identifies that exact gap. A source correction now selects direct links from source-relevant canonical documents before unrelated child links within the unchanged four-document bound. The focused loader test passed 6/6, and a direct repository context probe returned both `docs/decisions/release/packaging/0221-reviewed-cli-release-preparation.md` and `packages/core/src/writing-contract.ts` among twelve loaded documents for the three-source batch. This proves source behavior and local context selection, not an installed reviewer decision. The Mac resident worker still needs a guarded upgraded bundle and a fresh exact review before the historical rejection can close.
