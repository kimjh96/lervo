# ADR-0441: Isolate resident knowledge from Node conversations

Status: accepted
Decision date: 2026-09-28

## Context

The standalone Node currently runs the version-four resident knowledge owner in its
conversation process. Asynchronous scheduling does not isolate synchronous event
validation, canonical compilation, or filesystem work from that process's event loop.
An installed conversation recorded a failed repository snapshot at 30,165 ms, while an
independent capture of the same 6,512-file repository completed in 3,497 ms cold and
223–243 ms warm. This demonstrates an installed contention problem; it does not
attribute every delay to one particular compiler operation.

A concurrent repository replica also replaced the project manifest during a verified
read. The existing path guard correctly refused that observation. Another owner
observation refused changed workstream, assignment, or agent sources. These are
separate consistency checks and must remain intact.

## Decision

The standalone Node supplies its own immutable entry point to the resident host. For
event writer version four, with no injected legacy host, that adapter forks one child
using the same Node executable and artifact. The child opens its own local project
storage and runs the existing autonomous owner. No Hub is required. The repository
worker lock, outbox leases, source fences, delegation, provider admission, scoped
workforce, and verification contracts remain authoritative. Isolation grants no extra
provider calls, document writes, integrations, or asset dispositions.

The internal `knowledge-worker` route accepts a physical repository root, configured
provider, optional absolute provider executable, and exact owning parent PID. It
requires a connected Node IPC channel and matching actual parent. It is not a new
standalone authorization surface. Library hosts without a runtime entry retain their
existing execution behavior; those hosts cannot claim process isolation.

The parent retains one child handle until actual process close. Ordinary shutdown
sends the private `knowledge_worker_stop` control message and awaits child exit. The
child aborts its owner on that message, SIGINT, SIGTERM, or parent-channel disconnect;
it then awaits existing provider and lease cleanup and closes storage. A failed IPC
send falls back to SIGTERM. There is no forced kill, inferred quiescence, lease
deletion, or replacement child while the previous handle remains live. A shutdown
that cannot finish remains pending for the existing service-management contract.

Unexpected child close or launch failure is retried after sixty seconds while the
parent remains active. Recovery still inspects canonical source, assignment, and
uncertain-effect state through the existing worker. Parent shutdown cancels that
retry. This is an owned maintenance process, not another model agent or new durable
repository role.

## State, privacy, and failures

Process-local ownership consists of the child handle, its close promise, stop flag,
and optional retry timer. These are operational observations and introduce no new
canonical event or success state. The IPC stop message has only the exact `type`
field; it contains no source, prompt, provider output, credentials, or configuration.
Existing resident health records identify the actual child PID and a worker ID that
includes parent and child PIDs. Native provider evidence must follow that ancestry;
it must not continue attributing the provider process to the old resident PID.

`knowledge_worker_launch_failed` means a child could not launch or initialize its
owned version-four host. `knowledge_worker_process_exited` means its handle actually
closed unexpectedly. Both use bounded code-only journal output; neither claims
knowledge currency or releases uncertain authority. Ordinary cycle failures retain
their existing bounded codes. Snapshot deadlines, no-follow file checks, complete
execution evidence, unmanaged-change detection, and supervision consistency checks
are unchanged.

## Verification and delivery

Verify parent responsiveness during real child CPU work, await cleanup before stop
completes, reject unowned invocation, stop on parent disconnect, retain one child,
and cancel delayed retry during shutdown. Rehearse the bundled internal route on a
disposable writer-four repository without provider authority. Existing legacy worker,
common provider, Node lifecycle, and distribution checks remain required.

Installed acceptance requires exact predecessor-bound deployment, observation of the
new child ancestry and reader compatibility, and a fresh human Discord question
during actual background work. Source tests and separate-process snapshot timings
alone do not close that acceptance gate. Manifest replacement and task-source drift
still need independent observations; process isolation does not establish their
resolution.

## References

- [Background ownership](0433-own-background-knowledge-for-every-repository-change.md)
- [Convergence runtime](../../../../specs/background-knowledge-convergence/runtime.md)
- [Service management](../../../operations/services/0164-user-runtime-service-management-boundary.md)
