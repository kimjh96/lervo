# Kael post-r54 natural-goal incident: r79–r88

## Reviewed reactivation and provider change

With owner-approved maintenance, Kael's worker CLI bindings moved to byte-matched `settled-151d1b1f-r78`. A new owner-only configuration differed only in `discordConversation.deliberation.cliExecutable` and `outcomeSupervision.managedExecution.cliBundle`, installed under supervision and work upgrade fences.

Protected upgrades then installed:

- Hub r68 `sha256:5eccf325c12e76d67826b3b23c5ab14a078df15723f2097f069bf4b1820f67f1` from `643211c3`, the reader for `reviewed_authority_change`.
- Node r79 `sha256:cb61cbcb121a82d70b6bda76092b2230354d09deca6d407dfc89df8a29e8d580` from `643211c3`.
- Node r80 `sha256:01d3a8ffab1d9a26f9346e75d72601d5b0a4da374915102ce5671d98ceedac3b` from `69e8054f`.

On the owner's choice, mandate v3 was revoked at 8690 (`evt_eb4025f0a9f141ea92cc6cf769f4fbe2`). Mandate v4 (`sha256:be10b10e86cb852e3a04ecf5374033b95ff32c8beedc66f160b971a70a81f72f`, approval `sha256:6a3665fde4c8d0336e3562eca7b421a95d310b2c7d3bc0bec8d53ef8681cb0d1`) was installed at 8691. It is identical to v3 except for version, issue time, and a new 200,000-token owner epoch anchored at 8690.

Supervision stayed at `preflight_repair_requires_review` with no new decision. A read-only `resolve-preflight` review binds block 8688, supersession 8689, and installation 8691 (approval `sha256:815c01a3d6d091b5b5d8e4465d3cc39701c9fd2b11c541d9309149059fe3d539`). Recording was deliberately deferred until Codex's usage limit reset: an earlier owner turn would fail and end v4 reasoning history.

The 38 retained never-used worker checkouts could not be removed through `lervo workspace cleanup`, which accepts only integrated workspaces.

The owner chose Claude for owner reasoning. Mandate v5 (8692) added `claude` to providers and retained the epoch. A fenced configuration transition set `ownerReasoning` to `claude`/`claude-opus-5-5` and added Claude's executable and login context. Node PID `1574683` was active with zero restarts. Resolution was recorded at 8693 with approval `sha256:7737da9027630299b5f943560a5bf5fb6207529b0550b5a113e36b9e039da3df`.

## Claude authentication and spending boundary

First Claude owner run `osd_52212bddce2d556629ff3918` failed after about six seconds. Claude Code returned only a synthetic `Failed to refresh OAuth token` message with zero reported usage.

On the owner's choice, v5 was revoked at 8724 and v6 (`sha256:ee3f8f7d0c93faeb4dc5ad2155282168ec67ba5cbe93234b7db042ef068b5ed6`, event 8725) opened a new epoch anchored there. The retry failed identically. After each failure, unavailable usage closed the epoch and proposal-time spend checking stopped further decisions (`owner_plan_unavailable`). This was that path's first installed exercise.

Host diagnosis found:

- The stored Claude access token expired on 2026-09-23 16:13Z.
- `claude auth status` still reports `loggedIn: true`.
- `claude auth status` leaves an `.oauth_refresh.lock` directory with no live process; Lervo runs it as the login readiness probe just before each start.
- The lock remains without refreshing the token.

Claude owner reasoning therefore required interactive `claude auth login` on the host. The earlier stale lock was preserved as `.oauth_refresh.lock.stale-20260924T2233`.

## r81 workspace retirement

Commit `b6d761b0` was installed as Node r81 `sha256:474461c076f8c73fe7576bf0188cc9326983201c9443d710218511f4441c016c`, PID `1629689`, zero restarts. CLI `settled-b6d761b0-r81` ran `lervo workspace retire-unstarted` under the owner lease: first a one-workspace canary, then the rest. All 38 checkouts were removed; none refused. This freed 612 MB and left only the main worktree registered. Supervision, conversation, and sync then reported ready.

## r82–r87 claim and worker recovery

After the user refreshed Claude login on WSL, v6 was revoked at 8756 and v7 installed at 8757. The first Claude owner run completed with observed usage. Subsequent Node installation exposed four defects, each fixed and installed in order:

- `fcde1051` (r82) supersedes a never-bound claim at its start deadline, ending its loop before completion deadline.
- `b6dc36b5` (r83) makes claim commit rechecking ignore retired workspaces. The defect caused every uncertain claim after the 38-checkout retirement; the claim bound at 8798.
- `c9002460` (r84, fenced CLI rebind) journals the worker CLI failure reason.
- `e28df61d` (r85) keeps an unchanged blocked source reported as blocked. The previous behavior hid an owner epoch overrun by one 1,000-token reservation.

With owner approval, reservation became 160,000 through a fenced configuration transition. Mandate v8 (8807/`evt_a51b8f40…`, attempt 160,000, owner epoch 800,000) was installed.

`5e4e88ae` (CLI r86) passes `createTargetTurnId`, allowing the first real worker run (`d60565b1`) to edit both expected documents. It still failed `provider_result_failed`: the Opus SDK keyed `modelUsage` by `claude-opus-5-5[1m]`, violating the model-identity pattern.

`2c32b0a7` (Node and CLI r87, PID `1901611`) reads that key as its base model. A live two-path Opus managed run on WSL failed before the fix and passed after it. The owner escalated the failed attempt at 9022 (`uncertain_effect_requires_inspection`). Two issues remained: the task required a replay the worker could not run without a shell, and the worker used 510,144 tokens against the 160,000 attempt limit because usage was accounted only after the run.

## r88 token enforcement and remaining work

`0efdb339` (ADR-0432) was installed on Kael as Node and CLI r88, PID `1943423`, zero restarts, through a fenced transition. A supervised managed turn now stops with `provider_token_limit_exceeded` once turn-cumulative tokens exceed the attempt reservation.

The escalated attempt remains open: its replay task needs a shell, and ADR-0013 deliberately excludes Bash from managed Claude sessions.
