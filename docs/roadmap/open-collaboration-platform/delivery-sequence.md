# Open collaboration delivery sequence

Slices are ordered by dependency and how quickly they stop ongoing damage. Completion labels follow ADR-0452; listed verification must pass before an item earns its target label.

## Slice 0: reliability fixes that change no behaviour for healthy paths

### Replica error fidelity and explicit host-local exclusions

- Design: ADR-0456.
- Verification: an injected Git failure exposes its stderr digest in CLI and receipt; capture excludes the delegation grant when the repository's `HEAD` lacks the ignore rule.
- Current: `wired`, supported by [failure fidelity](../../specifications/coordination/node-change-driven-work/repository-replicas/failure-fidelity.md) and `apps/node-runtime/test/repository-replica-fidelity.test.ts`.
- Earns: `installed-proven` on the fleet.

### Divergence events and attention, once per identity

- Design: ADR-0456.
- Verification: the plen, flemo, and digimon backlog produces three `diverged` events and three `reconciled` events, then silence.
- Current: `wired`, supported by [divergence and merge](../../specifications/coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md) and `apps/node-runtime/test/repository-replica-divergence.test.ts`.
- Earns: `installed-proven`.

### Knowledge intake policy and per-file degradation

- Design: ADR-0457.
- Verification: the 57 stalled jobs re-queue; generated artifacts appear as `disposition: generated`; at least 90 percent reach `current` in seven days.
- Current: `wired` under the [per-change intake contract](../../specs/background-knowledge-convergence/runtime/change-intake.md). Unit tests cover generated dispositions, oversize skipping, sub-job splitting, and once-only re-queue.
- The governed provider review replaces the v4 placeholder reviewer. Fixture-provider tests cover a clean change reaching `current` with recorded usage, budget and authority exhaustion settling as attention, and once-only re-queue of placeholder-reviewed jobs.
- Earns: `installed-proven` on the Lervo repository only after the installed seven-day measurement.

### Platform boundary ratchet with baseline

- Design: ADR-0455.
- Verification: the ratchet passes on baseline and fails on an injected leak.
- Current: `wired`; see [Slice 0 delivery notes](../open-collaboration-platform.md#slice-0-delivery-notes).
- Earns: `installed-proven` (CI).

### Shared retry policy and error-fidelity lint

- Design: ADR-0452 section 3.
- Verification: outbound retry counters cannot exceed `attentionAfter`; lint rejects a rewrap without `cause`.
- Current: `wired`; see [Slice 0 delivery notes](../open-collaboration-platform.md#slice-0-delivery-notes).
- Earns: `installed-proven` (CI and fleet).

### Measurement attribution and the two missing channels

- Design: ADR-0459.
- Verification: Discord repository-work turns and knowledge workers emit receipts and usage; `measurement_unavailable` never fires in a week.
- Current: `wired`. Both channels record an attributed `resource.usage.recorded` event and a selected-and-loaded context receipt; `measurement_unavailable` fails the turn's completion gate.
- Evidence: unit and contract tests with fixture providers.
- Earns: `installed-proven` only after installed verification.

### Deliberation usage verification and `provider_claim_unproven`

- Design: ADR-0460.
- Verification: an artifact without complete `deliberation`-scope usage is `unverified`; a reply claiming two providers' opinions without a verified `dlb_` reference is repaired.
- Current: `wired`. Artifacts record `usageVerification`, convergence requires verified usage, the budget counts only complete usage of the expected scope, and unproven multi-provider replies are repaired.
- Earns: `installed-proven` only after installed verification.

## Slice 1: core seams the open features land on

| Item | Design | Closing verification | Depends on |
| --- | --- | --- | --- |
| Neutral platform action, speaker provisioning, provenance, and limits seams; native-chat conformance suite | ADR-0455 | Suite passes for Discord, Slack, and native-chat adapters; installed hire and thread creation unchanged | Slice 0 ratchet |
| Protocol handshake, writer lease, and handoff primitive | ADR-0456 | J2 on the Lervo repository | Slice 0 fidelity |
| Typed decision resolution with history | ADR-0453 | A human reply records `workstream.decision.resolved`; the Mac CLI shows it | none |
| Prepared retrieval snapshot and turn report | ADR-0459 | Compact prompt shows pointers within 150 ms; J1 footer shows hits and tokens | Slice 0 attribution |
| Compatibility window for delegation | ADR-0454 | Role migration between turns keeps a live delegation; `role_revision_drift` recorded | none |
| Deliberation tiers, built-in Tier 0 and 1 definitions, trigger policy, wired outputs (`createKnowledgeCandidates`, decision resolution, plan revision, memory) | ADR-0460 | A CLI Tier 1 run converges and produces a knowledge candidate and a resolved decision in one transaction | Slice 0 usage verification, ADR-0453 decision resolution |

## Slice 2: open the edges

| Item | Design | Closing verification | Depends on |
| --- | --- | --- | --- |
| Relevance fan-out, open `respondTo`, live mentions, `effects[]`, exchange budget | ADR-0454 | Acceptance items 1, 2, and 6 | Slice 1 seams and conformance suite |
| Principal mandate and proactive intervention loop | ADR-0453 | Acceptance items 1 to 5 | Slice 1 decision resolution |
| Conversation-decision knowledge source and instruction capture | ADR-0457 | A Discord decision and a terminal "from now on" each become reviewed candidates | Slice 0 intake |
| Per-conversation token budget and pruning | ADR-0459 | Budget trims fan-out at 80 percent; pruning adjusts after four weeks of metrics | Slice 1 turn report |
| Single-observation candidates and disclosure on every channel | ADR-0458 | A correction becomes a candidate and is disclosed on the next prompt | Slice 1 retrieval snapshot |
| Tier 0 cross-check triggers on terminal `adr_authoring` and `core_change`, managed-run `design_fork`, and room `agent_disagreement`; `deliberation_propose` effect | ADR-0460 | Authoring an ADR in Claude Code yields a Tier 0 line on the next compact prompt with no added latency; ordinary chatter evaluates to `none` | Slice 1 tiers, Slice 1 retrieval snapshot, Slice 2 fan-out |
| Document freshness: evidence-bound candidates, deterministic verification, Lervo-managed auto-apply with commit and revert, owner review surfaces | ADR-0463 | Fixtures F1 to F7 pass; a Lervo-managed stale reference is applied in the cycle that verifies it and reverted by one command; a user-owned candidate appears in `lervo knowledge freshness review`, the compact prompt, and the escalation batch | Slice 0 intake, stale-document detection wired on ADR-0023, Slice 1 retrieval snapshot |

### Document freshness evidence and gaps

Document freshness is `wired` under accepted [ADR-0463](../../decisions/knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) and its [specification](../../specifications/knowledge/document-freshness.md).

The resident freshness stage maps ADR-0464 detection to findings, generates candidates through the governed provider path, verifies them deterministically, applies Lervo-managed `factual_reference` hunks with a `Lervo Knowledge` commit, and reverts with one command. Fixtures F1 to F7 pass against scratch repositories with the fixture provider. User-owned candidates appear in `lervo knowledge freshness review`, `lervo application attention`, and the compact prompt line.

Two verification parts remain unmet:

- The escalation batch does not exist (ADR-0453), leaving the escalation question and reply parser without a consumer.
- Tier 0 does not exist (ADR-0460), so every consequential hunk, including a Lervo-managed `statement`, waits for the owner in `verified_pending_cross_check`.

## Slice 3: self-organizing and standing

| Item | Design | Closing verification | Depends on |
| --- | --- | --- | --- |
| Natural staffing with `hireOrigin` | ADR-0454 | Acceptance item 3 | Slice 2 fan-out, ADR-0453 for over-headcount |
| Discussions replace the ceremony; `conversation_note` memory | ADR-0454 | Acceptance item 5; ceremony code removed | Slice 2, ADR-0460 room trigger |
| Tier 1 escalation, supervision and principal-proxy triggers, daily deliberation ceiling in the mandate, `conversation-discussion-*` retired | ADR-0460 | J7; `outcomeChangeRate` above zero over two weeks | Slice 2 Tier 0, ADR-0453 loop |
| Cross-host convergence owner | ADR-0457 | One knowledge committer per repository across Mac and WSL | Slice 1 writer lease |
| Standing autonomy daemon with proxy handoff | ADR-0458 | J5 | Slice 2 principal mandate, ADR-0459 in-flight cap |
| Used-in-practice promotion; Discord wiring of intake and review; conversation recall | ADR-0458 | Acceptance items 1, 2, 4, and 5 | Slice 2 candidates |
| Consolidation normalization | ADR-0457 | Evidence retired to projection, short documents below 100, one specification tree | Slice 0 intake |
| Document freshness cross-check, `archive` operation, `document_freshness` mandate kind, installed journey | ADR-0463 | `installed-document-freshness-v1` on the Lervo repository; weekly freshness metrics reported | Slice 2 freshness, Slice 1 tiers, Slice 2 principal mandate |

### Document freshness status

- `archive` is `wired`: fixture F3 applies an archive with nine inbound link rewrites through owner approval.
- Tier 0 cross-check is `contract-only` until ADR-0460 Slice 1.
- The `document_freshness` mandate kind is deferred by the owner's 2026-10-05 decision.
- The installed journey ran once locally on a copy of the Lervo repository with the fixture provider. A real-provider installed run and the weekly metrics projection remain open.

## Slice 4: convergence

Run J1 to J7 end to end, record each with real-provider evidence under `docs/evidence`, add boundary regression tests, and relabel the journeys `converged`. Then apply the ADR-0452 section 8 vision amendments through the reviewed exact-rewrite path.
