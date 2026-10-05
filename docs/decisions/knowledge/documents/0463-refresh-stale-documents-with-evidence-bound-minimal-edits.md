# ADR-0463: Refresh stale documents with evidence-bound minimal edits

Status: `accepted`
Decision date: 2026-10-05
Builds on: [ADR-0464 document drift detection](0464-report-document-drift-and-historical-documents.md), [ADR-0462 stale attention](../../execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
Amends: [ADR-0023](0023-evidence-based-document-staleness.md), [ADR-0457](0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md), [ADR-0453](../../coordination/conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0460](../../coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Contract: [Document freshness specification](../../../specifications/knowledge/document-freshness.md)

## Context

The owner required automatic detection and correction of stale documents. [ADR-0464](0464-report-document-drift-and-historical-documents.md) wires detection: `lervo knowledge lint` reports `document_stale`, `markdown_link_target_missing`, `entrypoint_reference_missing`, and `document_role_target_missing`; `readRecordedDocumentStalenessReport` returns bounded `stale` and `unknown` lists. Before this decision, the only automatic writer was style normalization (ADR-0434, ADR-0457), which changes form, not facts.

Verified in the Argo repository (`git log`, times in +0900):

- `AGENTS.md` said "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`" for 7 h 24 min after v4 replaced v2 (`5da8133` 2026-10-04 20:52 to `c543a46` 2026-10-05 04:16). The correct target, `v4/argo4/live/engine.py: class Limits`, existed throughout.
- `README.md` named v2 as the running implementation and "learning every 6 hours" for 13 h 42 min after v4 landed, and 6 h 18 min after `AGENTS.md` was fixed (`d0c956e` 10:34).
- Root `FINAL-DESIGN.md` appeared current for 24 h 26 min after v1 was removed (`2e2798e` to `d0c956e`). Its eventual move to `docs/archive/` broke nine relative links.
- At the last edit, `AGENTS.md` still said "every 6 hours", thirteen minutes after `d5dffc8` made learning daily. This defect remained open at the decision date.

Each factual reference—a path, component name, or cadence—had byte-exact evidence in a connected-path change but stayed wrong until a human noticed. The compact terminal context also injected pending workstream approvals whose evidence had changed, steering agents with both stale instructions and stale approvals.

## Decision

Close the loop from stale finding to fresh document with the open-by-default edge feature `features.document_freshness.enabled`. Check authority at the consequential effect: writing user-owned bytes. Generate candidates for every stale document, verify deterministically and by cross-check, apply Lervo-managed changes, surface user-owned changes for approval, and make every apply reversible with one command. Edit only lines invalidated by cited changes; never rewrite the document.

### 1. Trigger and scheduling

Freshness runs after per-change intake (ADR-0457) in the knowledge resident's ADR-0461 fenced cycle, without a timer. Add `freshnessFindingsDigest` to the source fingerprint so changes to the detection report, a connected path or document, or candidate authority state trigger a cycle.

Input is the ADR-0464 recorded staleness report when `currentRevision` equals HEAD, plus `entrypoint_reference_missing` and `markdown_link_target_missing` findings. A pure function maps each document, with detection-side Git enrichment, to `DocumentFreshnessFindingV1`; the freshness stage infers no fields.

Order findings by priority class, then staleness age:

1. `safety`: a stale line matches repository safety patterns; defaults are `risk`, `limit`, `leverage`, `loss`, `credential`, `secret`, `deploy`, `production`, `live`.
2. `entrypoint`: `AGENTS.md`, `CLAUDE.md`, `README.md`, package guides.
3. `canonical`: decisions, specifications, lifecycle documents.
4. `other`.

Measure budgets under ADR-0459 with `channel: knowledge_worker`, `stage: document_freshness`: at most three candidates per cycle, 30,000 tokens per candidate, and 150,000 tokens per repository per day. Count the Tier 0 cross-check within the candidate budget. Admit a `safety` or `entrypoint` finding first in the cycle that observes it. Zero verified candidates from five or more daily attempts raises attention (ADR-0452 section 3).

### 2. Evidence-bound candidate

The provider receives one `FreshnessEvidenceBundle` containing:

- Stale document bytes and hash.
- For each changed connected path, a bounded unified diff between verified and current revisions. If the diff exceeds its bound, supply current lines around referenced symbols with `evidenceTruncated`.
- For each deleted path, its last revision, deleting commit, and replacement candidates from rename similarity and symbol search.
- The top three related canonical documents from the prepared retrieval snapshot (ADR-0459).
- The writing contract.

The provider returns `DocumentFreshnessCandidateV1` with `operation: edit | archive | no_change_needed | needs_owner_input` and ordered hunks for `edit`. Each hunk binds a source byte range, before-hash, replacement bytes, change class, and one or more claims citing only bundle evidence by path and hash.

A candidate becomes `verified` only after all deterministic checks pass:

- No output byte outside the hunks changes; output parses as CommonMark; managed-block markers remain unchanged (ADR-0021, ADR-0022).
- Every relative link and backticked path in the output exists in the current tree or is explicitly historical.
- Every `reference_target_missing` reason is resolved.
- Every claim cites bundle evidence; otherwise report `claim_unbound`.
- Changed bytes remain within both 25 percent of the document and 4 KiB.
- Entrypoint size bounds, ADR-0206 protected README coordinates, and the writing contract hold.

Candidates containing `statement` or `safety_or_policy` hunks, affecting user-owned documents, or using `archive` also require an ADR-0460 Tier 0 cross-check: "does each hunk follow from its cited evidence and change nothing else". `material_disagreement` rejects the candidate with contested claims; regenerate once, then raise attention. Add `document_freshness` to `DecisionPointSignal.kind`.

Until ADR-0460 Slice 1 supplies Tier 0, version 1 records `crossCheck: unavailable`, holds every such hunk as `verified_pending_cross_check`, and routes it to the owner. Owner approval substitutes for the missing cross-check; nothing in that state applies without approval.

### 3. Authority and ownership

Determine change classes as follows:

- `factual_reference`: a path, symbol, version, command, or quantity whose new value appears byte-exact in cited evidence.
- `statement`: prose not reducible to a byte-exact copy.
- `safety_or_policy`: a hunk on a line matching safety patterns, an imperative instruction line in `AGENTS.md` or `CLAUDE.md`, or the Decision section of a decision record.

| Ownership | `factual_reference` | `statement` | `safety_or_policy` |
| --- | --- | --- | --- |
| Lervo-managed: `lifecycleOwner: lervo`, `lervo_exact`, `lervo_v1` managed blocks, `docs/knowledge/**` | auto-apply | auto-apply | owner |
| User-owned: `lifecycleOwner: user`, `reviewed_exact`, `repository_tool`, or no role | owner, or proxy under a `document_freshness` mandate | owner | owner |

Generation, verification, and cross-check require no authority and remain budget-bound. Only applying a user-owned hunk is a consequential effect. In `AGENTS.md` and `CLAUDE.md`, hunks within Lervo-managed blocks use the ADR-0022 patch path; user-prose hunks follow the user-owned row. A candidate may apply partially and wait partially, and must report that state.

Narrowly amend ADR-0453: `PrincipalMandateV1.decisionKinds` may gain `document_freshness`, with consequence class `repository_internal_reversible`. Under that mandate, the proxy approves user-owned `factual_reference` hunks, capped by `maximumFreshnessApprovalsPerDay` (default 5), and the knowledge convergence owner applies them. The proxy writes no bytes. Version 1 installs no such kind by the owner decision below; every user-owned apply goes to the owner.

User-owned `statement` and `safety_or_policy` hunks always wait for the owner. Argo's stale `v2` risk-limit line is `safety_or_policy`: it would produce a candidate within one cycle and an owner question in the next escalation batch, not an automatic apply.

Every apply records an event, informational attention item, turn-report line, Discord notice in the next batch window, and a commit by `Lervo Knowledge` containing `Lervo-Freshness-Candidate: <candidateId>`.

Store before-bytes and their hash in CAS. `lervo knowledge freshness revert <candidateId>` restores them only when the current hash equals the candidate's after-hash; otherwise fail with `revert_conflict` and print the three-way instruction. Revert sets `freshnessHold` for the finding digest (default seven days), preventing contention with the owner. Apply requires the current hash to equal the candidate's source hash; otherwise mark the candidate `superseded` and regenerate next cycle.

### 4. Historical documents

Generate `archive` when a document is superseded rather than correctable: its publication group is `historical`, a canonical successor names it as superseded, or most connected paths are deleted with no replacement found.

Move it to the layout's historical root (default `docs/archive/`), prepend a historical banner naming the date and current document, rewrite inbound links, and change no other byte. User-owned archives use `relocation: reviewed_move` and wait for the owner; Lervo-managed archives auto-apply, subject to the cross-check requirement. ADR-0457 `retire_to_projection` retains ownership of evidence journals.

### 5. Surfaces and events

Add these operating attention kinds:

- `document_freshness_candidate`: user authority when owner approval is required.
- `document_freshness_applied`: informational; auto-resolves on acknowledgement.
- `document_freshness_blocked`: budget, repeated rejection, or zero successes.

Add one compact terminal context line of at most 200 bytes only when counts are non-zero, and a documents segment to the ADR-0459 turn report. Send owner approvals to Discord through the ADR-0453 escalation batch; translate a natural-language reply to `lervo knowledge freshness apply`. Provide `lervo knowledge freshness status|review|apply|revert`, with plan and apply shaped like `lervo knowledge structure`, including `--json`.

Record six lifecycle events: `document.freshness.candidate.created`, `.verified`, `.applied`, `.rejected`, `.reverted`, and `document.freshness.cycle.completed`. Payloads contain only relative paths, hashes, counts, codes, and identifiers; hunk and evidence bodies stay in CAS. Required fields are in the specification.

Failure codes `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, `cross_check_disagreement`, `source_changed`, `freshness_budget_exhausted`, `revert_conflict`, and `freshness_hold_active` mean the candidate did not apply and the document is unchanged. `source_changed` also means a newer candidate follows.

## Acceptance

Reproduce the Argo Git-history cases with fixture providers:

- F1: `AGENTS.md` references a removed `v2` engine while `v4/argo4/live/engine.py` contains `class Limits`. Expect `safety` class, owner authority, one candidate in the first cycle, and version 1 `crossCheck: unavailable` rather than Tier 0 agreement.
- F2: `README.md` has a broken `v2/README.md` link and "every 6 hours", against `v4/README.md` "daily". Expect `factual_reference`, proxy-eligible.
- F3: root `FINAL-DESIGN.md` references deleted handoff documents. Expect `archive`, a banner, and nine link rewrites.
- F4: an unrelated change produces no candidate; a correct document produces `no_change_needed`.
- F5: an owner edit during review produces `source_changed`.
- F6: apply then revert restores the hash and sets a hold.
- F7: a managed-block hunk uses the ADR-0022 patch path while a user-prose hunk in the same `AGENTS.md` waits.

The installed journey renames and commits a referenced path in a scratch repository. Within one change-driven cycle, the finding and a verified candidate exist within budget; the owner or proxy approves; the apply commit carries evidence; and `lervo knowledge freshness status` reports time to fresh. The owner decision limits the installed journey to the Lervo repository.

Report weekly metrics from events:

| Metric | Target |
| --- | --- |
| Time to fresh per priority class | p90 under 30 minutes to a verified candidate; under one escalation batch window to apply where a mandate exists |
| False-positive rate: `no_change_needed` plus owner rejections over candidates | Below 10 percent |
| Acceptance rate: applied over verified | Above 70 percent |
| Tokens per applied update | At or below 40,000 |
| Revert rate | Below 5 percent |

## Delivery

1. `wired`: finding-mapping, candidate, event, policy-key, and attention-kind schemas; `lervo knowledge freshness status` over rebuildable state.
2. `wired`: evidence bundle, governed generation, deterministic verification, CAS before-bytes, `review`, Lervo-managed auto-apply with commit, `revert`, and fixtures F1–F7.
3. Partly `wired`: attention items, compact line, and owner apply, reject, and acknowledge. The turn-report segment, escalation question, and reply parser lack a consuming host (ADR-0459, ADR-0453).
4. `contract-only`: Tier 0 and the `document_freshness` signal await ADR-0460 Slice 1; metrics projection is deferred.
5. `wired`: `archive` operation.
6. Deferred by owner decision: `document_freshness` mandate kind.
7. `installed-proven`: installed journey on the Lervo repository.

Also deferred: freshness of pending workstream approvals in compact context (recorded follow-up: a stale-hit marker under ADR-0459), non-Markdown sources, edits above the 25 percent bound, cross-repository evidence, and languages outside the English boundary (invariant 8).

## Owner decisions (2026-10-05)

1. Accept the authority matrix as designed. While Tier 0 is unavailable, Lervo-managed `statement` hunks also wait for the owner because they require cross-check.
2. Exclude `document_freshness` from version 1 principal mandate kinds. Every user-owned apply goes to the owner; defer the kind until ADR-0453 Slice 2 supplies the mandate contract.
3. Retain default safety patterns and the 150,000-token per-repository daily budget. Patterns match whole words without inflection; repositories add desired plural forms.
4. Run the installed journey only on the Lervo repository. Do not touch Argo.

## Consequences

Stale references no longer wait for human discovery. Costs are bounded provider spend, visible per update, and one new owner question per consequential stale document. Invariant 5 holds: user-owned bytes change only through exact, hash-bound, reversible approval. Invariant 3 holds: a verified candidate proves nothing until an apply event exists. Invariant 4 holds: candidates, holds, and bundles are rebuildable state under `.lervo/state`.
