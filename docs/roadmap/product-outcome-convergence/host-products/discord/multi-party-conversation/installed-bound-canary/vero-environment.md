# AXLI Vero silence and Python environment correction

## Failure evidence

AXLI accepted human `#axli` messages `1551026118725865594` at `2026-09-20T00:24:03.376Z` and `1551040881094828146` at `2026-09-20T01:22:42.999Z`. Each completed with `action: observe`, `reason: relevance_unavailable`, and no intent or outbound record. Preceding explicit Vero mention `1551025990262726800` selected `respond` but ended with `response_generation_failed`; the service journal at the matching second recorded `RepositorySnapshotError`.

The installed Node was active: these were neither unsent Discord messages nor an offline bot. Completed decisions must not be relabeled as successful replies.

Read-only reproduction of the common repository snapshot against `/home/jonghyeok/teams/axli` returned `The repository snapshot byte limit was exceeded.` The `services/worker/.venv` directory occupied approximately 1.3 GiB. Snapshot policy allowed 1 GiB and excluded `node_modules`, but not Python environments. A read-only differential snapshot excluding `.venv` included 1,263 files without error.

The common policy now excludes conventional `.venv` and `venv` dependency directories at any depth, retaining the same limit for included source. Focused snapshot/native interaction suites passed 19/19; Mac typecheck, build, and quality checks passed. Rebuilt WSL common snapshot captured the actual AXLI repository under default policy in 1.8 seconds with 1,263 files.

## Owned human-turn policy

AXLI has one deterministic product-owner turn owner: Vero priority 10, CEO per-channel priority 0, and both hired agents priority 0. Vero's existing `unaddressedHumanMessages: evaluate` sent even owned human follow-ups through the failing managed relevance evaluator, whose exception became a silent `relevance_unavailable` observation.

An owner-only candidate changed only Vero integration `itg_discord_vero01` to `unaddressedHumanMessages: respond`. All other AXLI integration, identity, capability, and provider fields remained semantically identical. This existing dedicated-dialogue policy bypasses relevance gating for an owned human turn while retaining exact-address and non-owner rules. It is not a core name-based special case and grants no repository authority.

## r36 AXLI installation

Linux Node distribution `sha256:c40c620789690d08322c1e90f2ae1eae3a98842f0cede04d537f42bdd3c3e542` (`runtime-c40c6207-r36`, bundle `sha256:e8a957d4ffb8e24db5386c1a73be0fa0d17541351b9d020dd581083f1637319f`) was archive-verified, installed immutably, and preflighted against all seven current configurations, using the candidate only for AXLI. Its bundle contained the corrected virtual-environment policy.

Immediately before upgrade, port 4317 was closed and AXLI had no child process. The exact r35 AXLI service definition was saved owner-only. The official service manager then upgraded only AXLI to r36 and the candidate configuration. Process `2936451` was active with zero restarts and matching health process ID; conversation, sync, workstream replication, and remote control were `ready`.

Supervision separately remained unavailable with `supervision_attention_required` and `aggregate_budget_exceeded`; the rollout neither renewed nor concealed that budget. A read-only post-upgrade `#axli` poll found no new human message. A fresh turn remains necessary for Discord reply and repository-work acceptance; no historical failure was resent or treated as executed.

## Remaining product-owner deployments

The other six installed product-owner deployments also used `evaluate` for their PO speaker; Tarin already used `respond`. Each owner-only candidate changed only that PO speaker to `respond`, retaining co-resident hired agents' `evaluate`, and passed installed r36 preflight. Each service had no child provider process before upgrade; its exact r35 definition was retained for rollback.

Elio canary reached overall, conversation, and supervision `ready` first. Shiflo, Plen, Flemo, Arca-next, and Digimon then reached overall and conversation `ready` individually. The final seven-service check found every Node active on r36 with zero restarts, conversation `ready`, and health process ID matching its systemd main PID. Six were overall `ready`; AXLI retained only its separate supervision budget degradation.

The selected review snapshot remained byte-identical at `sha256:07a46a15b427b9c2d6ac15e2102c50506916e742a5b548801f12142dd9cac2b5`; no approval or deployment decision changed.

## Validation and acceptance boundary

Refreshing only generated CLI release manifest and SBOM fields from the current shared bundle made both metadata checks pass. The full Mac suite passed 3,902 tests across 775 files with eight existing conditional skips; the focused snapshot regression passed 8/8 on WSL.

The existing 128 pending release intents still prevented a correction-specific intent; `release:completion:check` remained `intent_pending`. Operational Node installation is not a reviewed CLI release. Installed message success still requires a new human-authored Discord turn: old observed and failed events were durably completed under r35.
