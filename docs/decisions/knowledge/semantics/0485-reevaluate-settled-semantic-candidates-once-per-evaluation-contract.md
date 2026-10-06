# ADR-0485: Reevaluate settled semantic candidates once per evaluation contract

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0479](0479-park-rejected-semantic-candidates-and-settle-opaque-assets-by-the-delegation-suite.md), [ADR-0481](0481-bind-generated-projections-by-hash-in-lifecycle-plan-review.md), and [ADR-0482](0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md)
Amended by: [ADR-0486](0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) (stale reviews regenerate; discovery reuses the repository observation)

## Context

About 20 minutes after `main` `ddcb2978` was deployed on 2026-10-06, the WSL owner host showed these fixes not taking effect. Evidence from the host:

- At 16:42 UTC, all five new-runtime residents (`axli`, `digimon`, `flemo`, `shiflo`, `plen`) reported health `busy/knowledge_cycle_admission_wait`. The host-wide full-cycle slot had been held since 16:29:41 UTC by the `lervo` resident (pid 3373975, old runtime `178b8a1d`), which ran one long cycle. A full cycle claims up to eight stages, and each stage can call a provider for minutes. Waiters were admitted by random polling, so one repository could starve every other.
- `shiflo` and `flemo` therefore never re-evaluated. Their settled dependencies also had no general way to be re-evaluated by new logic. `shiflo`'s `canonical_target_preimage` dependency predates ADR-0482. `flemo`'s `knowledge_stage_failure_unclassified` was settled under `evaluationContract: "adr-0479"` with a six-hour wait. ADR-0479 re-evaluated only some legacy shapes, and only the source-limit code checked the contract. In addition, an unchanged fingerprint lets a new resident skip full cycles for up to 15 minutes after a restart.
- `axli`, which ran at 16:29 UTC, moved past the source limit. Its layout plan review was then rejected: `.lervo/knowledge/document-layout.yaml` and `.lervo/knowledge/source-lineage/…` were outside both `permittedTargets` and `managedTargets`. The writer authority check would have refused the same paths. These are Lervo-managed lifecycle files that every layout plan writes as `lervo_generated`. The rejection was thrown from the assessment stage, which ADR-0479 parking did not cover, so the whole obligation stopped with `parked = 0`.
- `digimon` retried `knowledge_stage_failure_unclassified` at `canonical_review`. Its private stage evidence shows `LervoProjectError not_initialized: .lervo/project.yaml does not exist`, thrown while the old resident completed an assignment during `lervo upgrade` at 16:29:07 UTC.

## Decision

- **Evaluation contract.** The runtime's contract is `adr-0485:<digest>`. The digest covers the exact bytes of the module that holds stage evaluation: the bundled runtime when installed, or the source file in development. Every dependency that the runtime or the owner settles records it. A dependency settled under any other contract, or under none, is re-evaluated once: its stage is requeued and settles again under the current contract. Uncertain-effect and recovery dependencies keep their own inspection, so no write is repeated blindly. The resident change fence also folds in the contract, so a new runtime runs a full cycle at once.
- **Fair admission.** Full-cycle waiters register their turn, and the oldest live waiter is admitted next. Between stages, the holder's owner asks whether another repository waits and stops if one does. Remaining work stays due.
- **Lifecycle scope.** `.lervo/knowledge/document-layout.yaml` and `.lervo/knowledge/source-lineage/` join the Lervo-managed convergence scope. The delegation and the asset disposition manifest stay outside it.
- **Lifecycle plan parking.** A rejected exact lifecycle plan regenerates identically, so it is parked at once by kind and plan hash, with the reviewer's reason. The kinds are `repository_layout`, `instruction_bootstrap`, and `instruction_bridge`. Assessment and final verification continue past it. Final verification treats a currency reason that only a parked plan leaves pending as parked, and records `knowledge_sources_parked` with a `lifecycle` entry. A changed plan is reviewed again.
- **Project manifest race.** A stage failure with code `not_initialized` becomes `knowledge_project_unavailable`, a typed transient failure with the 16-attempt budget.

## State, events, privacy, and failure meaning

No event type or state is added.

New failure code:

| Code                            | State             | Meaning                                                                               | Recovery                 |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `knowledge_project_unavailable` | `retry_scheduled` | The project manifest could not be read, as happens while `lervo upgrade` rewrites it. | Automatic bounded retry. |

Other changes:

- `knowledge_sources_parked` statuses may list `stage: "lifecycle"` entries, whose `path` is the plan kind.
- Settled dependencies gain an `evaluationContract` field.
- The admission database gains a `waiters` table holding a nonce, process ID, repository hash, and two timestamps. It has no paths.

## Verification

Focused tests must show:

- The oldest waiter is admitted next, and the holder sees contention.
- An owner stops after one stage when asked to yield.
- A dependency settled under `adr-0479` is re-evaluated once, while one settled under the current contract stays settled, and an uncertain-effect dependency keeps its own inspection.
- The fingerprint changes with the contract.
- `not_initialized` is retried as typed.
- The layout and lineage paths are managed, while authority files are not.
- A rejected lifecycle plan is parked and explains only its own currency reason.

Installed verification must show `axli`, `digimon`, `flemo`, and `shiflo` each leaving their 2026-10-06 post-deploy stops, and no resident waiting on admission behind one repository for more than one stage.
