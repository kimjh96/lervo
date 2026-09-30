# ADR-0441: Isolate resident knowledge from Node conversations

Status: accepted
Decision date: 2026-09-28

## Context

The standalone Node runs the version-four resident knowledge owner in its conversation process. Asynchronous scheduling does not isolate synchronous event validation, canonical compilation, or filesystem work from that event loop. An installed conversation failed a repository snapshot at 30,165 ms; an independent capture of the same 6,512-file repository took 3,497 ms cold and 223–243 ms warm. This establishes installed contention without attributing every delay to a particular compiler operation.

A concurrent repository replica replaced the project manifest during a verified read; the existing path guard correctly refused it. A separate owner observation refused changed workstream, assignment, or agent sources. Both consistency checks must remain intact.

## Decision

The standalone Node supplies an immutable entry point to the resident host. For event writer version four without an injected legacy host, the adapter forks one child using the same Node executable and artifact. The child opens its own local project storage and runs the existing autonomous owner without a Hub. Repository worker locks, outbox leases, source fences, delegation, provider admission, scoped workforce, and verification contracts remain authoritative. Isolation grants no additional provider calls, document writes, integrations, or asset dispositions.

The internal `knowledge-worker` route accepts a physical repository root, configured provider, optional absolute provider executable, and exact owning parent PID. It requires connected Node IPC and a matching actual parent; it creates no standalone authorization surface. Library hosts without a runtime entry retain existing execution behavior and cannot claim process isolation.

The parent retains one child handle until actual process close. Ordinary shutdown sends the private `knowledge_worker_stop` message and awaits child exit. The child aborts its owner on that message, SIGINT, SIGTERM, or parent-channel disconnect, then awaits existing provider and lease cleanup and closes storage. Failed IPC sending falls back to SIGTERM. There is no forced kill, inferred quiescence, lease deletion, or replacement child while the previous handle remains live. Unfinished shutdown remains pending under the existing service-management contract.

Unexpected child close or launch failure is retried after sixty seconds while the parent remains active. Recovery uses the existing worker to inspect canonical source, assignment, and uncertain-effect state. Parent shutdown cancels the retry. This is an owned maintenance process, not another model agent or durable repository role.

## State, privacy, and failures

Process-local ownership comprises the child handle, close promise, stop flag, and optional retry timer. These operational observations introduce no canonical event or success state. The IPC stop message contains only the exact `type` field, with no source, prompt, provider output, credentials, or configuration. Existing resident health records identify the actual child PID and a worker ID containing parent and child PIDs. Native provider evidence must follow that ancestry and must not attribute the provider process to the old resident PID.

`knowledge_worker_launch_failed` means the child could not launch or initialize its owned version-four host. `knowledge_worker_process_exited` means its handle actually closed unexpectedly. Both produce bounded code-only journal output; neither claims knowledge currency or releases uncertain authority. Ordinary cycle failures retain existing bounded codes. Snapshot deadlines, no-follow file checks, complete execution evidence, unmanaged-change detection, and supervision consistency checks remain unchanged.

## Verification and delivery

Verify parent responsiveness during real child CPU work, cleanup completion before stop completes, refusal of unowned invocation, stopping on parent disconnect, retention of one child, and cancellation of delayed retry during shutdown. Rehearse the bundled internal route on a disposable writer-four repository without provider authority. Existing legacy worker, common provider, Node lifecycle, and distribution checks remain required.

Installed acceptance requires exact predecessor-bound deployment, observation of new child ancestry and reader compatibility, and a fresh human Discord question during actual background work. Source tests and separate-process snapshot timings alone do not close this gate. Manifest replacement and task-source drift still require independent observations; process isolation does not establish their resolution.

## References

- [Background ownership](0433-own-background-knowledge-for-every-repository-change.md)
- [Convergence runtime](../../../../specs/background-knowledge-convergence/runtime.md)
- [Service management](../../../operations/services/0164-user-runtime-service-management-boundary.md)
