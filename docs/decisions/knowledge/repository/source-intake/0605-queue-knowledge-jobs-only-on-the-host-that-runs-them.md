# ADR-0605: Queue knowledge jobs only on the host that runs them

Status: `accepted`
Decision date: 2026-11-21
Amends: [ADR-0433](../canonicalization/0433-own-background-knowledge-for-every-repository-change.md) (the change event and its job in one transaction), [ADR-0466](../../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) ("queued change jobs wait for ownership"), [ADR-0597](../../maintenance/0597-keep-idle-and-non-owner-residents-off-the-repository.md) (non-owner duties)

## Context

On the Mac, axli is a non-owner: WSL has held its convergence lease since 2026-10-12. Its event store still held 743 unacknowledged `knowledge:repository` jobs, enqueued from 2026-10-17 to 2026-11-02. None had ever been claimed; each had 0 attempts. The `knowledge_job_transient_failure` code on 37 older rows came from jobs settled in early October, before ownership moved.

Two writers' facts met:

- `appendRepositoryChange` enqueued a job for every change, whoever ran the queue. The terminal Stop hook, a managed run and a Node conversation completion all called it with no ownership check.
- Only an owner's cycle claims jobs (ADR-0597). A non-owner runs host-local duties only, and nothing ever retired its jobs.

So a non-owner accumulated work it would never run. A cleanup sweep would hide that, not remove it.

## Decision

One rule decides whether a host may hold repository knowledge jobs: `repositoryKnowledgeJobAdmission(verdict)`. It sits beside the owner fence, because the same verdict decides who runs them.

- A recorded verdict that another host holds convergence (`waiting_owner`) refuses, with reason `convergence_owner_elsewhere`.
- A host that may not own convergence at all (`ineligible`, such as Hub mode without a delegation) refuses, with reason `convergence_owner_ineligible`.
- An owner, a host never configured for coordination, and the transient roles (`unverifiable`, `yielding`, `contended`) are admitted, so a Hub outage never drops an owner's jobs.

The rule is applied at both ends:

- **Enqueue.** `appendRepositoryChange` takes the admission as a required argument, so every writer must decide. The change event is always appended, because it is canonical. The job row is added only when the host is admitted. The terminal Stop observation, the managed run recorder and the Node conversation completion read the admission from the recorded fence before their transaction. The Stop observation also reports whether a job was really queued, not only whether a change was seen.
- **Hold.** In the non-owner cycle, a host the rule refuses settles every job it still holds through `retireRepositoryKnowledgeJobs`, up to twice the queue's own bound per cycle. These are jobs from before it lost ownership, or from an earlier release. Each one becomes an auditable `repository.knowledge.resolved` event in state `stale` with failure code `convergence_owner_elsewhere`. The requeue never puts a `stale` settlement back.

The existing backlog drains through this same rule, not through a sweep: axli's 743 jobs settle in the Mac's next non-owner cycle.

## Consequences

- **Nothing is lost on this host.** A change without a settled `current` job is already convergence debt (`knowledge_continuation_missing`). If the host becomes owner later, convergence assesses those paths again.
- **Unchanged coverage gap.** The owner reviews another host's changes only after they replicate. That was already true before this decision, which neither creates nor closes the gap.
- **One retirement per held job.** Each retirement is one event, so a host settles its backlog in one cycle and holds nothing after.

## Verification

- `repository-change-source.test.ts`: a refused admission records the event and no job.
- `repository-knowledge-job-admission.test.ts`: retirement settles every held job once as `stale` with the reason, and the requeue leaves it settled.
- `non-owner-job-retirement.test.ts`: a `waiting_owner` or `ineligible` cycle settles held jobs, an `unverifiable` one keeps them, and every role reads correctly from the recorded fence.
