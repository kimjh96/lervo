# ADR-0485: Reevaluate settled semantic candidates once per evaluation contract

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0479](0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md), [ADR-0481](0481-bind-generated-projections-by-hash-in-lifecycle-plan-review.md), and [ADR-0482](0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md)
Amended by: [ADR-0486](0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) (stale reviews regenerate; discovery reuses the repository observation)

## Context

About 20 minutes after `main` `ddcb2978` was deployed on 2026-10-06, the WSL owner host showed fixes not taking effect:

- At 16:42 UTC, all five new-runtime residents (`axli`, `digimon`, `flemo`, `shiflo`, `plen`) reported `busy/knowledge_cycle_admission_wait`. The `lervo` resident (pid 3373975, old runtime `178b8a1d`) had held the host-wide full-cycle slot since 16:29:41 UTC for one long cycle. A full cycle claims up to eight stages, each potentially calling a provider for minutes. Random polling admitted waiters, allowing one repository to starve all others.
- Consequently, `shiflo` and `flemo` never re-evaluated. Settled dependencies also lacked a general reevaluation mechanism for new logic: `shiflo`'s `canonical_target_preimage` predates ADR-0482; `flemo`'s `knowledge_stage_failure_unclassified` was settled under `evaluationContract: "adr-0479"` with a six-hour wait. ADR-0479 re-evaluated only some legacy shapes, and only source-limit code checked the contract. An unchanged fingerprint could also make a new resident skip full cycles for up to 15 minutes after restart.
- At 16:29 UTC, `axli` passed the source limit, but layout plan review rejected `.lervo/knowledge/document-layout.yaml` and `.lervo/knowledge/source-lineage/…` as outside both `permittedTargets` and `managedTargets`. Writer authority would reject them too, although every layout plan writes these Lervo-managed lifecycle files as `lervo_generated`. The rejection arose in assessment, outside ADR-0479 parking coverage, stopping the whole obligation with `parked = 0`.
- `digimon` retried `knowledge_stage_failure_unclassified` at `canonical_review`. Private stage evidence showed `LervoProjectError not_initialized: .lervo/project.yaml does not exist`, thrown as the old resident completed an assignment during `lervo upgrade` at 16:29:07 UTC.

## Decision

- **Evaluation contract:** The runtime contract is `adr-0485:<digest>`. The digest covers the exact bytes of the stage-evaluation module: the bundled runtime when installed, or the source file in development. Every dependency settled by the runtime or owner records it. A dependency settled under another contract or none is re-evaluated once: its stage is requeued and settles under the current contract. Uncertain-effect and recovery dependencies retain their own inspection; no write is repeated blindly. The resident change fence includes the contract so a new runtime immediately runs a full cycle.
- **Fair admission:** Full-cycle waiters register their turn; the oldest live waiter is admitted next. Between stages, the holder's owner checks whether another repository is waiting and stops if so. Remaining work stays due.
- **Lifecycle scope:** `.lervo/knowledge/document-layout.yaml` and `.lervo/knowledge/source-lineage/` enter the Lervo-managed convergence scope. The delegation and asset disposition manifest remain outside it.
- **Lifecycle plan parking:** A rejected exact lifecycle plan regenerates identically, so it is immediately parked by kind and plan hash with the reviewer's reason. Kinds are `repository_layout`, `instruction_bootstrap`, and `instruction_bridge`. Assessment and final verification continue past it. Final verification treats a currency reason left pending solely by a parked plan as parked and records `knowledge_sources_parked` with a `lifecycle` entry. A changed plan is reviewed again.
- **Project manifest race:** A stage failure with code `not_initialized` becomes `knowledge_project_unavailable`, a typed transient failure with a 16-attempt budget.

## State, events, privacy, and failure meaning

No event type or state is added.

| New failure code | State | Meaning | Recovery |
| --- | --- | --- | --- |
| `knowledge_project_unavailable` | `retry_scheduled` | The project manifest could not be read, as can happen while `lervo upgrade` rewrites it. | Automatic bounded retry. |

Other changes:

- `knowledge_sources_parked` statuses may include `stage: "lifecycle"` entries whose `path` is the plan kind.
- Settled dependencies gain `evaluationContract`.
- The admission database gains a `waiters` table containing a nonce, process ID, repository hash, and two timestamps. It contains no paths.

## Verification

Focused tests must show:

- The oldest waiter is admitted next, and the holder detects contention.
- An owner stops after one stage when asked to yield.
- A dependency settled under `adr-0479` is re-evaluated once; one settled under the current contract stays settled; an uncertain-effect dependency retains its own inspection.
- The fingerprint changes with the contract.
- `not_initialized` receives typed retry handling.
- Layout and lineage paths are managed; authority files are not.
- A rejected lifecycle plan is parked and explains only its own currency reason.

Installed verification must show `axli`, `digimon`, `flemo`, and `shiflo` each leaving their 2026-10-06 post-deploy stops, with no resident waiting on admission behind one repository for more than one stage.
