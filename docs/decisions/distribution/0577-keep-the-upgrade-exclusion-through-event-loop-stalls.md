# ADR-0577: Keep the upgrade exclusion through event-loop stalls

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0574](0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (the upgrade's lease and the checks before each stage), [ADR-0575](0575-follow-published-releases-on-every-host.md) (the follower's launchd process type), [ADR-0576](../operations/storage/0576-keep-full-cycle-admission-waits-through-sqlite-lock-contention.md) (renewal checks the row it changed)
Related: [ADR-0484](../operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) (upgrade exclusion), [ADR-0487](../operations/services/0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md) (planning inside the window)

## Context

The first hands-off rollout ran on v0.25.0 on 2026-11-17. On the owner's Mac, the host follower (`com.lervo.host.follow`) started `lervo upgrade --root argo --apply --safe` at 09:21:31 UTC. It was still running 40 minutes later.

- **Starvation.** The load average was 88 on 10 cores, mostly from the owner's own Python jobs. The follower's plist set `ProcessType` to `Background`. Its children inherit that QoS: priority 4, efficiency cores, and throttled I/O. The upgrade got about 0.15% of a core, 2:13 of CPU time in 37 minutes. `sample` showed one long synchronous task, the `plan()` recompute inside the exclusion, with heavy GC, sorting, and mapping. The same apply took about 9 minutes from a normal-priority shell in the v0.24.1 rollout.
- **Silent lease loss.** The upgrade took full-cycle admission at about 09:21:31. The holder renewed its 10-minute lease from a 60-second `setInterval`, and a blocked event loop never runs that timer. `tryAcquire` counts a holder only while `expires_at > now` and its process is alive. The lease lapsed, and argo's resident worker (pid 24577) was admitted at 09:56:24, exactly 10 minutes after the last renewal at 09:46:24. The upgrade's later renewals ran `UPDATE … WHERE nonce=?` against 0 rows, and nothing checked the count, so it still acted as the holder. Had planning finished, its Node stage would have restarted argo's Node worker during a resident cycle the upgrade believed it had excluded. That breaks the ADR-0484, ADR-0487, and ADR-0574 exclusion.

The follower's 90-minute runner bound reports a timeout as `failed`, not as a host failure. That part worked as designed.

## Decision

### The follower runs at standard priority

The service renderer picks the launchd `ProcessType` from the runtime. The `host-follow` runtime renders `Standard`. The Hub, Node, host resident, and replica coordinator keep `Background`. Upgrades are rare and hold a host-wide exclusion that stops every resident on the host, so they must not run at background QoS.

The process type comes from the runtime, not from a caller argument. The service manager renders the definition again from its coordinates and refuses one whose bytes differ. A caller argument would have to reach every render path, and a missed path would fail the install.

No systemd unit sets `Nice`, `CPUWeight`, `CPUSchedulingPolicy`, `IOSchedulingClass`, or `IOWeight`, so the follower already runs at normal priority on Linux. Nothing changes there.

The follower's definition bytes change, and the follower does not rewrite its own definition. Each macOS host runs `lervo host upgrade --follow --service install --apply` once after this release. Its plan shows the action `upgrade`.

### A holder detects a lost lease

- **Renewal checks the row.** Renewal runs `UPDATE holder SET expires_at=max(expires_at,?) WHERE slot=1 AND nonce=?` and reads the changed row count. Zero rows mean another holder was admitted after this lease lapsed. The admission is then lost for good, and renewal stops. `max` keeps a slower renewal from shortening a later one.
- **`held()`.** `FullCycleAdmission.held()` runs the same statement and returns whether it changed one row. Admission replaces the holder row in one transaction, and a nonce never comes back. So `true` also proves that nobody else was admitted since this holder, even if its lease lapsed while no one was waiting. Such a lease is renewed and still held. Under SQLite lock contention, `held()` answers from the last confirmed expiry. Other database failures throw, because a holder that cannot be confirmed must not act as the holder. After `release()`, `held()` is false.
- **Lease length is an option.** `leaseMilliseconds` defaults to 10 minutes. Renewal runs every minute, or ten times per lease when the lease is shorter.

### The upgrade checks before every consequential stage

- `lervo upgrade --apply` asks for a 2-hour lease. That outlasts the follower's 90-minute bound on one run, so a starved renewal timer cannot let the lease lapse while the follower still waits for the command. Residents of every release read `expires_at` from the same row, so no schema change is needed. A crashed or killed upgrade still frees the slot at once, because its process is gone.
- The apply confirms the exclusion before its first write. It confirms it again before each stage that changes the repository or a service: capabilities, workforce, terminal integration, each knowledge stage, the Node stage, the event writer, the host service, the replica service, and runtime retention. A lost admission fails the command with `knowledge_cycle_admission_lost`, and the next stage does not start.
- The upgrade confirms the exclusion once more after the last stage, before it reports a result. A holder that still holds was never replaced, so this one check proves that the whole apply ran under the exclusion. A loss during the last stage is reported as a failure, not as success.

The checks cannot stop a stage that is already running. A stage could overlap a resident cycle only if one stage stalls for more than 2 hours. The final check then reports the failure, and the follower retries.

### Takeover stays as it is

`tryAcquire` still takes the slot from a holder whose lease has expired, even if its process is alive. The rule is kept for three reasons:

- Residents of earlier releases take over on expiry whatever this release decides. The incident's resident was one. Only the holder's own lease length protects it from them.
- A live holder can hang: a stopped process, an endless synchronous loop, or a deadlocked runtime. If the lease never expired, such a holder would block every resident on the host until someone killed it.
- Crash recovery does not change. A dead holder frees the slot at once, whatever its lease.

## Failure code, states, and privacy

`knowledge_cycle_admission_lost`: `lervo upgrade --apply` lost the host's full-cycle admission to another holder. A background knowledge cycle may have started, so the upgrade stopped before its next stage. Stages applied before the loss stay applied. The next run plans again from the repository's state. The message carries no path, process ID, nonce, or repository hash. The host follower classifies the code as `failed` and retries the repository after 10, 20, and 40 minutes. It never counts as a host failure and never rolls back the CLI.

No event, column, table, or state file is added. The holder row keeps its fields; only the upgrade's `expires_at` is further ahead.

## Consequences

- A live but hung upgrade can hold residents back for up to 2 hours instead of 10 minutes. The follower's 90-minute bound kills its own runs before that.
- If a crashed upgrade's process ID is reused by another process, its row blocks residents until the lease expires: now up to 2 hours instead of 10 minutes.
- Residents do not call `held()` yet. A resident that stalls past its 10-minute lease can still lose the slot to an upgrade or another resident and keep working. That risk predates this change, and the incident did not show it. Follow-up: the resident loop checks `held()` at each stage boundary and stops with its own health reason; verify it with a blocked-timer resident test in `loop.test.ts`.
- The `plan()` recompute inside the exclusion is one long synchronous task on a large repository such as argo. Shortening it is a separate change.

## Verification

- `full-cycle-admission.test.ts`: a holder with a 300 ms lease blocks its event loop for 1.5 seconds while a resident in another process takes the slot. `held()` is then false, stays false, and the release leaves the resident's row. A second test blocks with no competitor, and `held()` stays true and renews the row. On origin/main, both fail: `holder.held is not a function`.
- `upgrade-resident-exclusion.test.ts`: the in-exclusion plan stalls on a live materialization. In that window the holder row expires and a resident is admitted. The upgrade then fails with `knowledge_cycle_admission_lost`, and the repository's plan is unchanged. On origin/main, the upgrade exits 0 instead.
- `runtime-service-render.test.mjs`: the launchd follower renders `Standard` and no `Background`. The Hub, Node, host resident, and replica coordinator keep `Background`, and no systemd unit sets a priority. On origin/main, the follower renders `Background`.
- `host-follow-policy.test.ts`: `knowledge_cycle_admission_lost` is classified as `failed`.

Installed verification: after the release that carries this change, reinstall the follower on the Mac and confirm that `launchctl print gui/$(id -u)/com.lervo.host.follow` no longer shows a background process type. Record the next follower-driven argo apply time in the [release-to-fleet roadmap](../../roadmap/operations/release-to-fleet.md).
