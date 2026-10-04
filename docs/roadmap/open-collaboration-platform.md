# Open collaboration platform

Status: `proposed`
As of: 2026-10-04

## Outcome

Make Lervo the operating experience defined in [ADR-0452](../decisions/foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md): an owner-run organization of durable agents that converse and self-organize, keep working and improving, act for the owner within a mandate, follow work between the Mac terminal and Discord, and ground and measure every turn, on a hardened provider-neutral local-first core. The [strengths matrix](open-collaboration-platform/strengths-matrix.md) records what each reference product does well, what Lervo does better, and the verified status of every adoption.

Lervo is `converged` only when the six true-Lervo journeys (ADR-0452 section 6) pass on installed Nodes with real Codex and Claude and a real guild, each with a regression test at the boundary. Until then every entry below carries the ADR-0452 completion label that its evidence supports.

## Delivery sequence

Slices are ordered by dependency and by how quickly they stop ongoing damage. Each names its ADR, the exact verification that closes it, and the label it earns.

### Slice 0: reliability fixes that change no behaviour for healthy paths

| Item                                                          | Design             | Verification                                                                                                                                                      | Earns                                      |
| ------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Replica error fidelity and explicit host-local exclusions     | ADR-0456           | Injected Git failure shows its stderr digest in CLI and receipt; capture excludes the delegation grant on a repository whose `HEAD` lacks the ignore rule         | `installed-proven` on the fleet            |
| Divergence events and attention, once per identity            | ADR-0456           | plen, flemo, digimon backlog produces three `diverged` events and three `reconciled` events, then silence                                                         | `installed-proven`                         |
| Knowledge intake policy and per-file degradation              | ADR-0457           | The 57 stalled jobs re-queue; generated artifacts appear as `disposition: generated`; at least 90 percent reach `current` in seven days                           | `installed-proven` on the Lervo repository |
| Platform boundary ratchet with baseline                       | ADR-0455           | Ratchet passes on baseline, fails on an injected leak                                                                                                             | `installed-proven` (CI)                    |
| Shared retry policy and error-fidelity lint                   | ADR-0452 section 3 | Outbound retry counters cannot exceed `attentionAfter`; the lint fails a rewrap without `cause`                                                                   | `installed-proven` (CI and fleet)          |
| Measurement attribution and the two missing channels          | ADR-0459           | Discord repository-work turns and knowledge workers emit receipts and usage; `measurement_unavailable` never fires in a week                                      | `installed-proven`                         |
| Deliberation usage verification and `provider_claim_unproven` | ADR-0460           | An artifact without complete `deliberation`-scope usage is `unverified`; a reply claiming two providers' opinions without a verified `dlb_` reference is repaired | `installed-proven`                         |

Current labels: knowledge intake policy and per-file degradation is `wired` under the [per-change intake contract](../specs/background-knowledge-convergence/runtime/change-intake.md). Its unit tests cover generated dispositions, oversize skipping, sub-job splitting, and the once-only re-queue. The v4 placeholder reviewer is replaced by the governed provider review: fixture-provider tests cover a clean change reaching `current` with recorded usage, budget and authority exhaustion settling as attention, and the once-only re-queue of placeholder-reviewed jobs. It earns `installed-proven` only after the installed seven-day measurement.

### Slice 1: core seams the open features land on

| Item                                                                                                                                                           | Design   | Verification                                                                                             | Depends on                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Neutral platform action, speaker provisioning, provenance, and limits seams; native-chat conformance suite                                                     | ADR-0455 | Suite passes for Discord, Slack, and native-chat adapters; installed hire and thread creation unchanged  | Slice 0 ratchet                                          |
| Protocol handshake, writer lease, and handoff primitive                                                                                                        | ADR-0456 | J2 on the Lervo repository                                                                               | Slice 0 fidelity                                         |
| Typed decision resolution with history                                                                                                                         | ADR-0453 | A human reply records `workstream.decision.resolved`; the Mac CLI shows it                               | none                                                     |
| Prepared retrieval snapshot and turn report                                                                                                                    | ADR-0459 | Compact prompt shows pointers within 150 ms; J1 footer shows hits and tokens                             | Slice 0 attribution                                      |
| Compatibility window for delegation                                                                                                                            | ADR-0454 | Role migration between turns keeps a live delegation; `role_revision_drift` recorded                     | none                                                     |
| Deliberation tiers, built-in Tier 0 and 1 definitions, trigger policy, wired outputs (`createKnowledgeCandidates`, decision resolution, plan revision, memory) | ADR-0460 | A CLI Tier 1 run converges and produces a knowledge candidate and a resolved decision in one transaction | Slice 0 usage verification, ADR-0453 decision resolution |

### Slice 2: open the edges

| Item                                                                                                                                                               | Design   | Verification                                                                                                                                | Depends on                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Relevance fan-out, open `respondTo`, live mentions, `effects[]`, exchange budget                                                                                   | ADR-0454 | Acceptance items 1, 2, and 6                                                                                                                | Slice 1 seams and conformance suite                        |
| Principal mandate and proactive intervention loop                                                                                                                  | ADR-0453 | Acceptance items 1 to 5                                                                                                                     | Slice 1 decision resolution                                |
| Conversation-decision knowledge source and instruction capture                                                                                                     | ADR-0457 | A Discord decision and a terminal "from now on" each become reviewed candidates                                                             | Slice 0 intake                                             |
| Per-conversation token budget and pruning                                                                                                                          | ADR-0459 | Budget trims fan-out at 80 percent; pruning adjusts after four weeks of metrics                                                             | Slice 1 turn report                                        |
| Single-observation candidates and disclosure on every channel                                                                                                      | ADR-0458 | A correction becomes a candidate and is disclosed on the next prompt                                                                        | Slice 1 retrieval snapshot                                 |
| Tier 0 cross-check triggers on terminal `adr_authoring` and `core_change`, managed-run `design_fork`, and room `agent_disagreement`; `deliberation_propose` effect | ADR-0460 | Authoring an ADR in Claude Code yields a Tier 0 line on the next compact prompt with no added latency; ordinary chatter evaluates to `none` | Slice 1 tiers, Slice 1 retrieval snapshot, Slice 2 fan-out |

### Slice 3: self-organizing and standing

| Item                                                                                                                                        | Design   | Verification                                                                      | Depends on                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Natural staffing with `hireOrigin`                                                                                                          | ADR-0454 | Acceptance item 3                                                                 | Slice 2 fan-out, ADR-0453 for over-headcount      |
| Discussions replace the ceremony; `conversation_note` memory                                                                                | ADR-0454 | Acceptance item 5; ceremony code removed                                          | Slice 2, ADR-0460 room trigger                    |
| Tier 1 escalation, supervision and principal-proxy triggers, daily deliberation ceiling in the mandate, `conversation-discussion-*` retired | ADR-0460 | J7; `outcomeChangeRate` above zero over two weeks                                 | Slice 2 Tier 0, ADR-0453 loop                     |
| Cross-host convergence owner                                                                                                                | ADR-0457 | One knowledge committer per repository across Mac and WSL                         | Slice 1 writer lease                              |
| Standing autonomy daemon with proxy handoff                                                                                                 | ADR-0458 | J5                                                                                | Slice 2 principal mandate, ADR-0459 in-flight cap |
| Used-in-practice promotion; Discord wiring of intake and review; conversation recall                                                        | ADR-0458 | Acceptance items 1, 2, 4, and 5                                                   | Slice 2 candidates                                |
| Consolidation normalization                                                                                                                 | ADR-0457 | Evidence retired to projection, short documents below 100, one specification tree | Slice 0 intake                                    |

### Slice 4: convergence

Run J1 to J7 end to end, record each with real-provider evidence under `docs/evidence`, add the boundary regression tests, and relabel the journeys `converged`. Then apply the ADR-0452 section 8 vision amendments through the reviewed exact-rewrite path.

## Acceptance metrics

Reported weekly from ADR-0459 projections, per channel and agent:

- Hit precision at or above 0.7 on conversation and supervision channels; miss rate below 0.1; stale-hit rate below 0.02.
- Tokens per successful outcome trending down over four weeks for one standing goal; no supervised run exceeds its reservation in flight.
- Duplicate human-turn answers below 5 percent; exchange budget exhaustion visible every time it occurs.
- Per-change knowledge jobs reaching `current` at or above 90 percent; zero generated review sources.
- Replica failures: at most one attention item per divergence identity; zero silent repeats.
- Proxy settlements: 100 percent inside mandate scope, each with a recorded decision event.
- Deliberation: Tier 0 rate of 100 percent on `adr_authoring` points; `outcomeChangeRate` above zero for Tier 1 and 2; zero `unverified` artifacts counted toward convergence; `laterDefectRate` reported with and without deliberation; Tier 0 cost at or below 24,000 tokens per run.

## Relabeling applied in this change

Under ADR-0452 section 5, the following entries moved from `implemented` to `wired` because their evidence is packed temporary consumers or fixture providers: every item in [Prime-Agent-derived execution outcomes](product-outcome-convergence/execution.md) except provider-native resume; every item in [repository knowledge outcomes](product-outcome-convergence/repository-knowledge.md); reviewed local and authenticated live triggers, Slack, dynamic execution graphs, replaceable components, and separately installed hosts in [host-product outcomes](product-outcome-convergence/host-products.md). Guild `/goal` intake and the supervision token ceiling keep installed evidence and are labelled `installed-proven`. The multi-party conversation entry replaces the undefined `installed acceptance required` with `delivery required`.

## Corrections to the diagnosis

Verification changed several premises: "Tarin" is a deployment identity, not a code mapping; `waiting_decision` tracks the supervisor's own effects, not user decisions; `.gitignore` already excludes the convergence grant, and the real gap is the missing explicit pathspec exclusion; mentions of several agents already produce several owners; the hire path already admits allowlisted agents and supervision already detects staffing gaps; the conversation `not_applicable` rule is surface-neutral; the built-in integrations file is an open extension point; the package-boundary script reads dependencies, not imports; two patterns were promoted, not one; and the supervision token ceiling is already installed-proven, so the research claim that Lervo lacks a token-budget experience is outdated. Deliberation audit: all 11 formal runs happened on 2026-08-25 from the CLI inline policy with 0 `converged`, no `deliberation`-scope usage, and no downstream consumer; the Discord natural path never reached the deliberation core because a separate discussion protocol was wired for the same effect; the 2026-10-01 "Sol and Opus opinions" reply was ordinary conversation with only Claude usage observed.

## References

- [Product outcome convergence](product-outcome-convergence.md)
- [Discord-first reference product](product-outcome-convergence/host-products/discord-first-reference-product.md)
- [Autonomous background convergence](knowledge/autonomous-background-convergence.md)
- [Product vision](../product/vision.md)
