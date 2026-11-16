# ADR-0570: Reuse one replica peer connection and back off an unreachable peer

Status: `accepted`
Decision date: 2026-11-16
Amends: [ADR-0415](../../coordination/sync/0415-bounded-replica-transport-and-service-completion.md) (peer transport), [ADR-0461](0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (replica recovery back-off)
Related: [ADR-0468](../../coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md), [ADR-0483](../../coordination/sync/0483-run-replica-commands-through-one-current-runtime.md)

## Context

On 2026-11-16 the owner could not keep WSL restarted. Windows reported socket error `0x80072747` (WSAENOBUFS), last seen on 2026-10-25 and 2026-10-26. The Mac runs the repository replica coordinator as `dev.lervo.repository-replica` for five repositories. Its configuration used `pollIntervalMs: 30000`, `peerWatch: false`, and `/usr/bin/ssh` to Windows OpenSSH over Tailscale with `remoteCommandPrefix: ["wsl.exe", "-d", "Ubuntu", "--"]`.

Read-only observation of the coordinator, which had run for 2 days 3 hours, found:

- 34 `ssh` children in 60 seconds, about 2,000 per hour and 50,000 per day.
- `SshRepositoryReplicaPeer.execute` started a new `ssh` process, TCP connection, Windows `sshd` session, and `wsl.exe` launch for every peer step.
- `wsl.exe` boots a stopped WSL, so the coordinator restarted WSL within seconds of every shutdown.

The owner's interim mitigation set `destination` to an `~/.ssh/config` alias reaching the WSL `sshd` through a ProxyJump. It removed the prefix and added OpenSSH `ControlMaster`, `ControlPath`, and `ControlPersist` arguments. The change removed every `wsl.exe` launch and left one mux connection. The coordinator still started about 50 `ssh` clients per 90 seconds.

Four defects combined:

1. **Every peer step opened its own transport connection.** No product code reused one. A configuration without hand-written multiplexing paid one TCP and SSH handshake per step.
2. **A held divergence pinned all replicas to the base interval.** ADR-0461 doubled the recovery interval only while every replica's latest cycle was `current`. Any other outcome, and any hint for any replica, reset the shared interval. `shiflo` had been divergent with `conflicting_paths` since 2026-10-07, so health showed `recoveryIntervalMs: 30000` and all five replicas were swept every 30 seconds. A local edit in one repository also reset the other four.
3. **Each idle cycle made two peer requests.** A cycle that found both sides equal still asked for a peer snapshot and repeated the ADR-0468 supersession exchange. Nothing had changed, and no history moves when both sides are equal.
4. **An unreachable peer was retried every cycle.** A transport failure was just another non-current outcome. Every replica retried at the base interval, and each attempt launched `wsl.exe`. The existing back-off could not help because it only lengthened intervals while everything was current.

Measured with a counting peer port in the node-runtime suite, an unchanged current replica made two peer requests per recovery cycle (`snapshot`, `reconcileKnowledgeSupersession`). At a fixed 30-second sweep, the five replicas set an idle floor of 1,200 requests per hour. Change-driven cycles raised that to the observed rate.

## Decision

### Lervo owns connection reuse

The coordinator composes its SSH arguments through `repository-replica-ssh-connection.ts`. Every install receives this behavior without configuration changes.

- When the transport executable is an OpenSSH `ssh` client on a host other than Windows, Lervo appends `ControlMaster=auto`, `ControlPath=<state directory>/replica-ssh/%C`, and `ControlPersist=600`. Every peer step and every peer watch is then a channel on one master connection. The state directory is the one that holds the coordinator `stateFile`.
- The control directory is created with mode `0700`. An existing directory that is not a real directory owned by the user, or that grants group or other access, disables reuse (`control_directory_unsafe`), because a control socket grants command execution on the peer.
- A path too long for the platform socket limit falls back to a 16-character hash of the configured transport. If even that path is too long, reuse is disabled (`control_path_unsupported`). The limit is 103 bytes on macOS, including OpenSSH's 17-byte temporary master suffix. Paths with whitespace are quoted, and `%` is escaped.
- Configured options always win. If coordinator arguments set any of `ControlMaster`, `ControlPath`, `ControlPersist`, `-M`, or `-S`, Lervo adds none of them (`configured`). The owner's mitigation keeps working unchanged.
- Lervo also adds `ConnectTimeout=15`, `ServerAliveInterval=15`, and `ServerAliveCountMax=3` when they are not configured. A master on a dead link exits within 45 seconds, so the next step connects afresh instead of waiting on the dead master until its deadline.
- Other clients, such as a test double, receive no options (`client_not_openssh`). Windows OpenSSH has no multiplexing, including `ssh.exe` run from WSL through interop, and receives only the keepalive options (`windows_client`). A disabled reuse mode other than `client_not_openssh` is logged once at startup.

Each step remains a bounded process with its own 512 MiB output bound, its 60-second default deadline, exit code, and structured failure. ADR-0415 is otherwise unchanged.

**Rejected for now: a persistent peer session.** In that design, one long-lived `ssh` child would run a framed peer server over stdio. It would also remove the per-step remote `node` start, but it requires:

- a new wire protocol on both sides;
- version negotiation with every deployed peer runtime, since an older peer has no server action;
- request multiplexing for up to four concurrent reconciliations;
- framed streaming of bundles up to 512 MiB;
- restarting the server whenever `lervo upgrade` moves the peer's `current` runtime pointer (ADR-0483).

Each of those surfaces can fail in new ways. OpenSSH multiplexing is mature, works with every deployed peer runtime, and keeps each step's existing failure contract. If the remaining per-step remote process cost is ever measured as significant, the persistent session can be added behind the same peer port.

### Each replica backs off on its own

`ReplicaRecoverySchedule` replaces the shared ADR-0461 interval with one interval per replica:

- A cycle ending `current` or `held` schedules that replica's next recovery cycle one interval after the cycle finishes, then doubles the interval up to `idleRecoveryCeilingMs`.
- `held` means nothing changed since the previous cycle: a divergence whose identity was already observed, or the same structured failure as the previous cycle.
- Any other outcome returns that replica to the base interval. So does a hint for that replica.
- One replica's activity never shortens another replica's interval.
- A recovery cycle becomes due only after the replica's previous cycle has finished, and never queues while that replica is pending or running.

Health `recoveryIntervalMs` now reports the shortest interval of any replica.

### A settled supersession exchange is not repeated

`ReplicaKnowledgeSupersessionExchange` remembers, per replica, the last exchange that changed nothing. Such an exchange dropped or held no commit on either side and taught the local side no new entry. The local half of the exchange always runs first, because it is local and cheap. The peer request is skipped only when all of these hold:

- both sides show the same snapshot as the remembered exchange;
- the local result has the same entries and no drop or hold;
- the remembered exchange is less than 15 minutes old, the same window as the capture-version proof.

Equal sides move no history, so ADR-0468's requirement that supersession be authoritative before history moves still holds. A transfer, merge, or changed snapshot always exchanges. A peer ledger change without a snapshot change is picked up within 15 minutes.

### An unreachable peer closes one shared gate

A cycle whose structured failure is a transport failure closes `ReplicaPeerBackoff` for the whole peer. A transport failure has code `repository_replica_transfer_failed` or `repository_replica_transfer_timeout` at stage `transfer`. A failure reported by the peer runtime is never a transport failure.

- While the gate is closed, no reconciliation starts and no peer watch is resubscribed. Hints still queue, coalesced as before.
- At the retry time, exactly one probe runs: `capture-version`, the cheapest peer request.
- The wait starts at the base recovery interval and doubles up to `idleRecoveryCeilingMs`, which defaults to 10 minutes.
- Cycles that fail during one outage count once.
- A probe or cycle that reaches the peer reopens the gate. Only the replicas the gate parked run once more, including one whose parked cycle is still finishing; every other replica stays on its own schedule.
- A replica whose transport failure recurs after the peer answered anyone is isolated until it completes a cycle again. Each of its transport failures is confirmed with one immediate `capture-version` probe. If the peer answers, the failure is the replica's own and is `held` on its schedule, so the gate stays open for the replicas that work. If the probe fails too, it is a peer outage and closes the gate like any first failure. Without isolation, one replica failing faster than a sibling succeeds would close and reopen the gate continuously and rerun every replica at once. Without the confirming probe, a probe that flapped during an outage could isolate every replica and the gate would never close again. The cost is one request per isolated failure.
- One-shot `reconcile` runs are not gated.

A stopped or restarting WSL therefore receives one connection attempt per back-off period instead of one per replica per cycle.

### Per-call launchers are surfaced, never rewritten

`repositoryReplicaPeerLauncher` in `@lervo/sync` detects a peer remote command whose prefix or Node executable is `wsl`, `wsl.exe`, or `ubuntu*.exe`. Each of these starts or wakes WSL for every step. `bash.exe` is not matched, because Git for Windows ships a `bash.exe` that never touches WSL. The advisory is `repository_replica_peer_per_call_launcher`, and its guidance is: each replica peer step launches the launcher, so point `peer.destination` at the WSL `sshd` and remove `peer.remoteCommandPrefix`. It surfaces:

- once on coordinator stderr at startup;
- in health `advisories`;
- in the `lervo upgrade` replica service stage as `peerLauncher`, with the guidance line.

The configuration is not rewritten, because Lervo cannot prove that the peer host runs a reachable WSL `sshd`.

### Host symmetry

Every host runs the same coordinator code and the same reuse, back-off, and advisory rules. Nothing restricts Lervo to one host. Local execution without a Hub is unaffected.

## Events, state, privacy, and failure meaning

- No new canonical event.
- Health (`<state>.health.json`, owner-only) gains optional `peer: { status: "backing_off", consecutiveFailures, retryAt }` while the peer gate is closed. It also gains optional `advisories: string[]` of stable codes. Neither contains a path, host name, or command output. Neither proves parity or freshness.
- `<state directory>/replica-ssh/` is an owner-only directory of OpenSSH control sockets, rebuilt on demand. A stale socket is replaced by OpenSSH. Deleting the directory only costs one new connection.
- `lervo upgrade` adds `peerLauncher` to the replica service stage. It contains only an executable name, never a path.
- Coordinator log lines: one when the peer becomes unreachable, naming the retry time and the consecutive count. One when it answers again. One at startup for a per-call launcher or a disabled reuse mode.
- Failure meaning is unchanged. A transport failure still fails the cycle, records attention on the local receipt, and never claims parity. A closed gate means only that the coordinator is waiting, not that the peer is down for good.

## Consequences

The counting peer port shows these request counts for an unchanged current replica:

| Cycle               | Before | After |
| ------------------- | -----: | ----: |
| First               |      4 |     4 |
| Each later recovery |      2 |     1 |
| Every 15 minutes    |      3 |     3 |
| Push                |      5 |     5 |

The 15-minute row is `snapshot`, exchange, and `capture-version`. A push is `snapshot`, exchange, `apply`, the verifying `snapshot`, and the receipt.

The owner's configuration has five replicas, one held, a 30-second base, and the default 10-minute ceiling. Its idle steady state falls from 1,200 requests per hour to about 50. All of them are channels on one connection. In the first hour after a restart, each replica runs 10 recovery cycles instead of 120. While the peer is unreachable, the coordinator makes one probe per back-off period, reaching one per 10 minutes, instead of 10 requests per 30 seconds.

The watch tests replayed against the previous code measure the scheduling change:

- A held replica beside a replica edited every 20 seconds ran 121 recovery cycles in one hour. It now runs 10.
- Three replicas with the peer unreachable for 449 seconds and one local edit per second started 494 cycles, each a new connection attempt. Now one cycle fails and three probes run, at 30, 90, and 210 seconds.

Peer-side changes on a replica without peer watches are still noticed within the recovery ceiling, as under ADR-0461. A local change still reconciles within the 250 ms coalescing window.

## Follow-ups

- With `peerWatch: true`, `repository-replica watch` emits its 60-second keepalive as a `changed` frame, so every watched replica runs a change cycle each minute. A distinct keepalive frame needs a protocol version that older coordinators accept. Verify that an idle watched replica makes no change cycle for 10 minutes.

## References

- [Subscriptions and recovery](../../../specifications/coordination/node-change-driven-work/repository-replicas/subscriptions-and-recovery.md)
- [Failure fidelity](../../../specifications/coordination/node-change-driven-work/repository-replicas/failure-fidelity.md)

ADR-0461 carries no "Amended by" back-link to this decision because it is already at the 16 KiB documentation bound.
