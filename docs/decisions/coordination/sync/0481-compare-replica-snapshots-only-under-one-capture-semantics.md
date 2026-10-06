# ADR-0481: Compare replica snapshots only under one capture semantics

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (peer protocol), [ADR-0478](0478-renew-each-delegation-with-one-writer.md) (rollout)
Related: [ADR-0468](0468-propagate-knowledge-supersession-across-replicated-checkouts.md)

## Context

ADR-0478 changed replica capture so that a convergence delegation that `HEAD` tracks enters the snapshot with its worktree bytes. After it was deployed on 2026-10-06, the WSL owner rebound plen at 15:09:38Z, and the renewal persisted on WSL. The Mac never received it:

- The Mac coordinator runs `repository-replica reconcile` from the current Node bundle `440443b568063aac`, which captures a tracked delegation.
- The coordinator configuration pins the peer command to `remoteRuntimeExecutable: ~/.local/lib/lervo-node/runtime-f9cb5a3a-r1/dist/bin.js` on WSL. That older bundle still restores the delegation's `HEAD` entry during capture, so its snapshot of WSL ignored the renewal. The WSL Node itself runs `~/.local/share/lervo/runtimes/node/440443b568063aac`.
- The pinned runtime reported `sha256:ce74c166…` for WSL. The Mac's own capture was the same hash, because its file still held the `HEAD` bytes. The coordinator saw two equal snapshots that matched the common base and recorded `current` at 15:43:52Z. A direct capture with the current runtime on WSL gives `sha256:067a5d1f…`.

Change detection was not at fault. The WSL watcher woke the cycle, and the snapshot cache fingerprint covered the file. The defect is that the coordinator compared snapshots computed under two different capture semantics. Neither side could detect this, so the follower stayed behind indefinitely and no failure was reported.

## Decision

### Every runtime names its capture semantics

`REPOSITORY_REPLICA_CAPTURE_VERSION` names the semantics one runtime implements. The current value is `lervo.repository-replica.capture.v2`, which is the ADR-0478 semantics. The value must change whenever the same repository bytes can produce a different snapshot. The snapshot-cache fingerprint version derives from it, so a cache written under other semantics never matches.

A new peer action, `repository-replica capture-version`, prints `{"schemaVersion":1,"captureVersion":"<version>"}`. It takes no root and reads no repository.

### The coordinator refuses mixed semantics

After it observes both snapshots and before it compares them, each cycle asks both sides for their capture version (stage `protocol`). The local side answers in process. The SSH peer runs the new action:

- A valid answer is used as is. An answer that does not match `lervo.repository-replica.capture.v<N>` fails with `repository_replica_capture_version_invalid`.
- A runtime older than this action exits 1 with its usage line. That line does not list `capture-version`, so the adapter reads it as the legacy semantics `lervo.repository-replica.capture.v1`. The adapter checks raw stderr because Node prints a long source line before an uncaught usage error.
- Any other failure, such as SSH exit 255, remains `repository_replica_transfer_failed`.

When the two versions differ, the cycle fails with `repository_replica_capture_incompatible` at stage `protocol`. The cycle writes no snapshot, records no reconciliation, and does not move the common base. The failure follows the ordinary receipt, health, attention, and log path. The error message names both versions and asks the operator to update the peer runtime path.

A successful comparison is trusted for 15 minutes in one coordinator process. A redeployed peer is therefore checked again without adding an SSH round trip to every cycle.

### Recovery

After the peer path points at a runtime with the same capture version, the next cycle observes the real difference and pulls it. Pinning the peer to a stale bundle still needs an operator fix, but it now fails visibly and blocks nothing else.

## Events, state, and failure meaning

No event or persistent state is added. Two failure codes are new, and one code is internal to the SSH adapter:

- `repository_replica_capture_incompatible` (stage `protocol`): the two sides capture under different semantics. No snapshot was compared and nothing moved.
- `repository_replica_capture_version_invalid` (stage `protocol`): the peer's answer was malformed.
- `repository_replica_capture_version_unsupported`: the peer runtime predates the action. The adapter maps this code to the legacy version, so it never reaches a receipt.

## Compatibility and deploy order

A new coordinator works with an old peer runtime and reports the incompatibility instead of a false `current`. An old coordinator never calls the new action. Deploy the Node bundle, then update the coordinator configuration's `remoteRuntimeExecutable` to the peer's current runtime payload, and restart the coordinator.

## Consequences

- A replica whose two sides capture differently stops with a named failure instead of hiding a change.
- Every future change to capture semantics must bump the capture version.

## Verification

Focused tests show:

- A Mac and WSL checkout track the delegation, and only the WSL delegation changes. A peer that reports the legacy version fails the cycle with `repository_replica_capture_incompatible` at `protocol`, and the state file and Mac bytes stay unchanged. With a current peer, the next cycle pulls the owner's exact bytes, and the cycle after that is `current`.
- The `capture-version` command prints the runtime's version.
- The SSH adapter reads a current answer, maps an uncaught legacy usage error with a 20,000-character source line to the legacy version, keeps SSH exit 255 as a transfer failure, and rejects a malformed answer.
- The installed WSL bundle `runtime-f9cb5a3a-r1` answered `capture-version` with exit 1 and the legacy usage line.
