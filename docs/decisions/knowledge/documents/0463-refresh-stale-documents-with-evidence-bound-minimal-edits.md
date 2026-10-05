# ADR-0463: Refresh stale documents with evidence-bound minimal edits

Status: `accepted`
Decision date: 2026-10-05
Builds on: [ADR-0464 document drift detection](0464-report-document-drift-and-historical-documents.md), [ADR-0462 stale attention](../../execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
Amends: [ADR-0023](0023-evidence-based-document-staleness.md), [ADR-0457](0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md), [ADR-0453](../../coordination/conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0460](../../coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Contract: [Document freshness specification](../../../specifications/knowledge/document-freshness.md)

## Context

The owner required early on that stale documents be detected and brought up to date automatically. Detection is wired by [ADR-0464](0464-report-document-drift-and-historical-documents.md): `lervo knowledge lint` reports `document_stale`, `markdown_link_target_missing`, `entrypoint_reference_missing`, and `document_role_target_missing`, and `readRecordedDocumentStalenessReport` returns the bounded `stale` and `unknown` lists. Nothing updates a document: the only automatic writer is style normalization (ADR-0434, ADR-0457), which rewrites form, not facts.

Verified in the Argo repository (`git log`, times in +0900):

- `AGENTS.md` told agents "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`" for 7 h 24 min after v4 replaced v2 (`5da8133` 2026-10-04 20:52 to `c543a46` 2026-10-05 04:16). The correct target, `v4/argo4/live/engine.py: class Limits`, existed the whole time.
- `README.md` named v2 as the running implementation and "learning every 6 hours" for 13 h 42 min after v4 landed, and 6 h 18 min after AGENTS.md was already fixed (`d0c956e` 10:34).
- `FINAL-DESIGN.md` sat at the root as if current for 24 h 26 min after v1 was removed (`2e2798e` to `d0c956e`), with nine relative links broken by its eventual move to `docs/archive/`.
- At the last edit, `AGENTS.md` still says "every 6 hours" thirteen minutes after `d5dffc8` made learning daily. The defect is open now.

Each case is a factual reference (a path, a component name, a cadence) whose evidence is a byte-exact change in a connected path. Each stayed wrong because the only path to a fix was a human noticing. Meanwhile the compact terminal context injected pending workstream approvals whose evidence had changed, so agents were steered by stale instructions and stale approvals at once.

## Decision

Lervo closes the loop from stale finding to fresh document as an open-by-default edge feature, `features.document_freshness.enabled`, with authority checked at the single consequential effect: writing bytes the user owns. The feature produces candidates for every stale document, verifies them deterministically and by cross-check, applies Lervo-managed changes itself, surfaces user-owned changes for approval, and keeps every apply reversible with one command. It never rewrites; it edits the lines a cited change invalidated.

### 1. Trigger and scheduling

Freshness is a stage of the knowledge resident, after per-change intake (ADR-0457), inside the ADR-0461 fenced cycle. It has no timer. The source fingerprint gains `freshnessFindingsDigest`, so a cycle runs when the detection report changes, when a connected path or document changes, or when a candidate's authority state changes. Input is the ADR-0464 output: the recorded staleness report when its `currentRevision` equals HEAD, plus the `entrypoint_reference_missing` and `markdown_link_target_missing` findings. A pure function maps each document, with detection-side Git enrichment, to a `DocumentFreshnessFindingV1`; the freshness stage infers no field itself.

Findings are ordered by priority class, then by staleness age: `safety` (a stale line matches the repository's safety patterns, by default `risk`, `limit`, `leverage`, `loss`, `credential`, `secret`, `deploy`, `production`, `live`) before `entrypoint` (`AGENTS.md`, `CLAUDE.md`, `README.md`, package guides) before `canonical` (decisions, specifications, lifecycle documents) before `other`. Budgets are measured under ADR-0459 with `channel: knowledge_worker`, `stage: document_freshness`: at most three candidates per cycle, 30,000 tokens per candidate, 150,000 tokens per repository per day, and a Tier 0 cross-check counted inside the candidate budget. A `safety` or `entrypoint` finding is admitted first in the cycle that observes it. Zero verified candidates from five or more attempts in a day is itself an attention item (ADR-0452 section 3).

### 2. Evidence-bound candidate

The provider receives one `FreshnessEvidenceBundle`: the stale document bytes and hash; for each changed connected path a bounded unified diff between the verified and current revisions or, when the diff exceeds its bound, the current lines around the referenced symbols with `evidenceTruncated`; for each deleted path its last revision, deleting commit, and replacement candidates found by rename similarity and by symbol search; the top three related canonical documents from the prepared retrieval snapshot (ADR-0459); and the writing contract. It returns a `DocumentFreshnessCandidateV1` with `operation: edit | archive | no_change_needed | needs_owner_input` and, for `edit`, ordered hunks. A hunk binds a byte range of the source, its before-hash, replacement bytes, a change class, and one or more claims each citing evidence by path and hash from the bundle only.

A candidate is `verified` only after deterministic checks pass: the output changes no byte outside the hunks and parses as CommonMark with managed-block markers unchanged (ADR-0021, ADR-0022); every relative link and backticked path in the output exists in the current tree or is explicitly marked historical; every `reference_target_missing` reason of the finding is resolved; every claim cites bundle evidence (`claim_unbound` otherwise); changed bytes stay within 25 percent of the document and 4 KiB; entrypoint size bounds and the ADR-0206 protected README coordinates hold; the writing contract passes. Candidates whose hunks include the class `statement` or `safety_or_policy`, whose document is user-owned, or whose operation is `archive` additionally need an ADR-0460 Tier 0 cross-check on the question "does each hunk follow from its cited evidence and change nothing else"; `material_disagreement` rejects the candidate with the contested claims, regenerates once, then raises attention. `DecisionPointSignal.kind` gains `document_freshness`. Until ADR-0460 Slice 1 ships Tier 0, version 1 records `crossCheck: unavailable`, holds every such hunk in the state `verified_pending_cross_check`, and routes it to the owner. Owner approval substitutes for the missing cross-check, and nothing in that state applies without it.

### 3. Authority and ownership

Change classes are deterministic: `factual_reference` (a path, symbol, version, command, or quantity whose new value appears byte-exact in cited evidence), `statement` (prose not reducible to a byte-exact copy), and `safety_or_policy` (a hunk on a line matching the safety patterns, an imperative instruction line of `AGENTS.md` or `CLAUDE.md`, or the Decision section of a decision record). Authority follows ownership and class:

| Ownership                                                                                             | `factual_reference`                                  | `statement` | `safety_or_policy` |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- | ------------------ |
| Lervo-managed: `lifecycleOwner: lervo`, `lervo_exact`, `lervo_v1` managed blocks, `docs/knowledge/**` | auto-apply                                           | auto-apply  | owner              |
| User-owned: `lifecycleOwner: user`, `reviewed_exact`, `repository_tool`, or no role                   | owner, or proxy under a `document_freshness` mandate | owner       | owner              |

Candidate generation, verification, and cross-check need no authority; they are bounded by budget. Only the apply of a user-owned hunk is a consequential effect. In `AGENTS.md` and `CLAUDE.md`, hunks inside Lervo-managed blocks apply through the ADR-0022 patch path and hunks in user prose follow the user-owned row; one candidate may therefore apply in part and wait in part, and says so.

ADR-0453 is amended narrowly: `PrincipalMandateV1.decisionKinds` may gain `document_freshness`, consequence class `repository_internal_reversible`. Under it the proxy approves, and the knowledge convergence owner applies, `factual_reference` hunks on user-owned documents, at most `maximumFreshnessApprovalsPerDay` (default 5). The proxy still writes no bytes. By the owner decision below, version 1 installs no such kind, so every user-owned apply goes to the owner. `statement` and `safety_or_policy` hunks on user-owned documents always wait for the owner; the stale `v2` risk-limit line in Argo is `safety_or_policy` and would have been a candidate within one cycle and an owner question in the next escalation batch, not an auto-apply.

No apply is silent. Every apply records an event, an informational attention item, a turn-report line, a Discord notice in the next batch window, and a commit by `Lervo Knowledge` carrying `Lervo-Freshness-Candidate: <candidateId>`. Every apply is reversible: the candidate stores the before-bytes in CAS with their hash; `lervo knowledge freshness revert <candidateId>` restores them when the current hash equals the candidate's after-hash, else fails with `revert_conflict` and prints the three-way instruction. A reverted document receives a `freshnessHold` for its finding digest (default seven days) so the loop never contends with the owner. Apply requires the current hash to equal the candidate's source hash; otherwise the candidate is `superseded` and regenerated next cycle.

### 4. Historical documents

When a document is superseded rather than correctable (its publication group is `historical`, a canonical successor names it as superseded, or most connected paths are deleted with no replacement found), the candidate is `archive`: move to the layout's historical root (default `docs/archive/`), prepend a historical banner naming the date and the current document, rewrite inbound links, and change no other byte. User-owned archives follow `relocation: reviewed_move` and wait for the owner; Lervo-managed archives auto-apply. ADR-0457 `retire_to_projection` continues to own evidence journals.

### 5. Surfaces and events

Attention items `document_freshness_candidate` (user authority when the owner must approve), `document_freshness_applied` (informational, auto-resolving on acknowledgement), and `document_freshness_blocked` (budget, repeated rejection, or zero successes) join the operating attention union. The compact terminal context adds one line of at most 200 bytes only when counts are non-zero. The ADR-0459 turn report gains a documents segment. Owner approvals reach Discord through the ADR-0453 escalation batch; a natural-language reply translates to `lervo knowledge freshness apply`. The CLI is `lervo knowledge freshness status|review|apply|revert`, plan and apply shaped like `lervo knowledge structure`, with `--json`.

Six events record the lifecycle: `document.freshness.candidate.created`, `.verified`, `.applied`, `.rejected`, `.reverted`, and `document.freshness.cycle.completed`. They carry relative paths, hashes, counts, codes, and identifiers only; hunk and evidence bodies stay in CAS. The specification lists their required fields. Failure codes `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, `cross_check_disagreement`, `source_changed`, `freshness_budget_exhausted`, `revert_conflict`, and `freshness_hold_active` each mean the candidate did not apply and the document is unchanged; `source_changed` also means a newer candidate follows.

## Acceptance

Fixtures reproduce the Argo cases from git history with fixture providers: F1 `AGENTS.md` pointing at a removed `v2` engine while `v4/argo4/live/engine.py` holds `class Limits` (`safety` class, owner authority, one candidate in the first cycle, and in version 1 `crossCheck: unavailable` instead of Tier 0 agreement); F2 `README.md` with a broken `v2/README.md` link and "every 6 hours" against `v4/README.md` "daily" (`factual_reference`, proxy-eligible); F3 root `FINAL-DESIGN.md` with deleted handoff documents (`archive` with banner and nine link rewrites); F4 an unrelated change yields no candidate and a correct document yields `no_change_needed`; F5 an owner edit during review yields `source_changed`; F6 apply then revert restores the hash and sets a hold; F7 a managed-block hunk applies through the ADR-0022 patch while a user-prose hunk in the same `AGENTS.md` waits. The installed journey renames a referenced path in a scratch repository and commits; within one change-driven cycle the finding exists, a verified candidate exists within budget, the owner or proxy approves, the apply commit carries evidence, and `lervo knowledge freshness status` reports the time to fresh. Metrics, reported weekly from events: time to fresh per priority class (target p90 under 30 minutes to a verified candidate, under one escalation batch window to apply where a mandate exists), false-positive rate (`no_change_needed` plus owner rejections over candidates, target below 10 percent), acceptance rate (applied over verified, above 70 percent), tokens per applied update (at or below 40,000), and revert rate (below 5 percent).

## Delivery

1. `wired`: schemas for the finding mapping, candidate, events, policy keys, and attention kinds; `lervo knowledge freshness status` over the rebuildable state.
2. `wired`: evidence bundle, governed generation, deterministic verification, CAS before-bytes, `review`, Lervo-managed auto-apply with commit, `revert`, and fixtures F1 to F7.
3. `wired` in part: attention items, the compact line, and owner apply, reject, and acknowledge. The turn-report segment, escalation question, and reply parser have no consuming host yet (ADR-0459, ADR-0453).
4. `contract-only`: Tier 0 and the `document_freshness` signal wait for ADR-0460 Slice 1; the metrics projection is deferred.
5. `wired`: the `archive` operation.
6. Deferred: the `document_freshness` mandate kind, by the owner's decision.
7. `installed-proven`: the installed journey on the Lervo repository.

Deferred: freshness of pending workstream approvals in the compact context (a stale-hit marker under ADR-0459 is the recorded follow-up), non-Markdown sources, edits above the 25 percent bound, cross-repository evidence, and languages other than the English boundary (invariant 8).

## Owner decisions (2026-10-05)

1. The authority matrix is accepted as designed. While Tier 0 is unavailable, a Lervo-managed `statement` hunk also waits for the owner, because it needs the cross-check.
2. `document_freshness` is not a version 1 principal mandate kind. Every user-owned apply goes to the owner, and the kind stays a documented deferral until ADR-0453 Slice 2 provides the mandate contract.
3. The default safety patterns and the per-repository daily budget of 150,000 tokens stand. Patterns match whole words without inflection, so a repository adds the plural forms it wants.
4. The installed journey runs on the Lervo repository only. Argo is not touched.

## Consequences

Stale references stop waiting for a human to notice. The cost is bounded provider spend, visible per update, and one new owner question per consequential stale document. Invariant 5 holds: user-owned bytes change only through an exact, hash-bound, reversible approval; invariant 3 holds: a verified candidate proves nothing until an apply event exists; invariant 4 holds: candidates, holds, and bundles are rebuildable state under `.lervo/state`.
