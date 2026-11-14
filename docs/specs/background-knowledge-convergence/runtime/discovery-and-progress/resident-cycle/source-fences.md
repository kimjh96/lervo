# Source fences

A source fence compares a complete capture of the repository with the snapshot a convergence state is bound to. A mismatch fails with `source_bytes_changed`. Each fence site is one of two kinds.

- **Exact** (`assertSourceExact`, `ConvergenceSourceObservation.exact`): a complete capture taken now. It guards an effect, the settlement claim, or verification evidence. No unrelated await separates the fence from the first write it guards.
- **Current** (`assertSourceCurrent`, `ConvergenceSourceObservation.current`): a decision check. It decides whether work is worth doing, or binds a stage receipt that settlement fences again. A wrong "unchanged" answer can waste work, including a provider call, but the next exact fence still refuses.

Both kinds are complete captures today. A context without a `sourceObservation` captures every time. After its own repository effect, a stage calls `noteChange()`, so a later current check observes the repository again.

## Classification

| Site                                                                | Kind    | Guards                                                   |
| ------------------------------------------------------------------- | ------- | -------------------------------------------------------- |
| Host settlement (`assertSettlement`)                                | Exact   | The durable claim, inside the event lock                 |
| Settled output commit (`settled-output-boundary.ts`)                | Exact   | The knowledge commit                                     |
| Seal start and seal application (`canonical-workspace.ts`)          | Exact   | Workspace provision and the seal                         |
| Integration candidate and completion                                | Exact   | The candidate apply and the integration ref move         |
| Root apply (`canonical-integration-effect.ts`)                      | Exact   | Working-tree writes                                      |
| Normalization generation and apply                                  | Exact   | Candidate storage and working-tree writes                |
| Lifecycle prefix and ordered lifecycle apply                        | Exact   | Working-tree writes                                      |
| Lifecycle asset settlement (`lifecycle-final.ts`)                   | Exact   | The asset settlement record                              |
| Candidate resolution                                                | Exact   | Candidate transitions                                    |
| Capacity ref retirement (`canonical-integration-stage.ts`)          | Exact   | The restoring ref commit                                 |
| Target preflight, before synchronization                            | Exact   | Integration ref synchronization, absorption or restore   |
| Stage verification observation                                      | Exact   | Verification evidence                                    |
| Host `prepareStage`, both `assertCurrent` checks, `runStage`        | Current | Whether a stage runs; settlement fences its result       |
| Stage receipt                                                       | Current | The receipt binding, fenced by settlement                |
| Provider call checks and the in-call poll                           | Current | Whether a provider call starts, continues or is recorded |
| Per-draft and pre-plan checks in sealing                            | Current | Writes to the private workspace; seal application fences |
| Target preflight result, retained integration inspection            | Current | Parking and retirement decisions; their effects fence    |
| Lifecycle currency pair, assessment sources after a lifecycle apply | Current | Stable inputs for currency and lint; settlement fences   |

The design classified target preflight's opening check as a decision. It stays exact because `synchronizeIntegrationTarget` follows it and can move, create, or absorb the integration ref.

## Evidence that exact fences alone protect effects

`test/effect-fence-exact-sweep.test.ts` and `test/effect-fence-decision-sweep.test.ts` drive full convergences with a session whose validation always answers "unchanged" and never notices another writer. It honors `noteChange()`. A developer edit lands in one of two places:

- Just before the first exact fence at each site. Every such edit ends in `source_bytes_changed`, and HEAD, refs, sources and candidate stores stay unchanged until the next observation.
- At the first decision check of each site. No effect, and no change to that state, may follow before the next exact fence, which must refuse.

`test/canonical-layout-parking.test.ts` covers the capacity ref retirement, which no full scenario reaches.
