# ADR-0463: Refresh stale documents with evidence-bound minimal edits

Status: `accepted`
Decision date: 2026-10-05
Builds on: [ADR-0464 document drift detection](0464-report-document-drift-and-historical-documents.md), [ADR-0462 stale attention](../../execution/applications/0462-own-workstream-bookkeeping-and-stale-attention.md)
Amends: [ADR-0023](0023-evidence-based-document-staleness.md), [ADR-0457](0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md), [ADR-0453](../../coordination/conversations/agent-organization/0453-act-for-the-owner-through-a-principal-mandate.md), [ADR-0460](../../coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)
Amended by: [ADR-0557](freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md) (Tier 0 in an independent no-capability session)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)
Contract: [Document freshness specification](../../../specifications/knowledge/document-freshness.md)

## Context

The owner required automatic detection and correction of stale documents. ADR-0464 wires detection: `lervo knowledge lint` reports `document_stale`, `markdown_link_target_missing`, `entrypoint_reference_missing`, and `document_role_target_missing`; `readRecordedDocumentStalenessReport` returns bounded `stale` and `unknown` lists. Previously, only style normalization (ADR-0434, ADR-0457) wrote automatically, changing form rather than facts.

Verified in Argo's `git log` (times in +0900):

- `AGENTS.md` said "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`" for 7 h 24 min after v4 replaced v2 (`5da8133`, 2026-10-04 20:52, to `c543a46`, 2026-10-05 04:16). The correct target, `v4/argo4/live/engine.py: class Limits`, existed throughout.
- `README.md` named v2 as the running implementation and said "learning every 6 hours" for 13 h 42 min after v4 landed, and 6 h 18 min after `AGENTS.md` was fixed (`d0c956e`, 10:34).
- Root `FINAL-DESIGN.md` appeared current for 24 h 26 min after v1 was removed (`2e2798e` to `d0c956e`). Its eventual move to `docs/archive/` broke nine relative links.
- At its last edit, `AGENTS.md` still said "every 6 hours", thirteen minutes after `d5dffc8` made learning daily. This defect remained open.

These paths, component names, and cadences had byte-exact evidence in connected-path changes but depended on a human noticing. Compact terminal context also injected pending workstream approvals whose evidence had changed, steering agents with stale instructions and approvals.

## Decision

Close the loop from stale finding to fresh document through the open-by-default edge feature `features.document_freshness.enabled`. Produce candidates for every stale document, verify them deterministically and by cross-check, apply Lervo-managed changes, and surface user-owned changes for approval. Check authority at the consequential effect: writing user-owned bytes. Every apply must be reversible with one command. Edit only lines invalidated by a cited change; never rewrite the document.

### 1. Trigger and scheduling

Run freshness in the knowledge resident after per-change intake (ADR-0457), inside the ADR-0461 fenced cycle, without a timer. Add `freshnessFindingsDigest` to the source fingerprint so a cycle runs when the detection report, a connected path or document, or a candidate's authority state changes.

Input is ADR-0464's recorded staleness report when `currentRevision` equals HEAD, plus `entrypoint_reference_missing` and `markdown_link_target_missing` findings. A pure function maps each document, with detection-side Git enrichment, to `DocumentFreshnessFindingV1`; the freshness stage infers no fields.

Order findings by priority class, then staleness age:

1. `safety`: a stale line matches repository safety patterns; defaults are `risk`, `limit`, `leverage`, `loss`, `credential`, `secret`, `deploy`, `production`, `live`.
2. `entrypoint`: `AGENTS.md`, `CLAUDE.md`, `README.md`, and package guides.
3. `canonical`: decisions, specifications, and lifecycle documents.
4. `other`.

Measure budgets under ADR-0459 with `channel: knowledge_worker`, `stage: document_freshness`: at most three candidates per cycle, 30,000 tokens per candidate, and 150,000 tokens per repository per day. Tier 0 cross-checks count inside the candidate budget. Admit a `safety` or `entrypoint` finding first in the cycle that observes it. Zero verified candidates from five or more attempts in a day raises attention (ADR-0452 section 3).

### 2. Evidence-bound candidate

The provider receives one `FreshnessEvidenceBundle` containing:

- Stale document bytes and hash.
- For each changed connected path, a bounded unified diff between verified and current revisions; if it exceeds its bound, current lines around referenced symbols with `evidenceTruncated`.
- For each deleted path, its last revision, deleting commit, and replacement candidates found by rename similarity and symbol search.
- The top three related canonical documents from the prepared retrieval snapshot (ADR-0459).
- The writing contract.

It returns `DocumentFreshnessCandidateV1` with `operation: edit | archive | no_change_needed | needs_owner_input` and ordered hunks for `edit`. Each hunk binds a source byte range, before-hash, replacement bytes, change class, and one or more claims citing evidence by path and hash from the bundle only.

A candidate becomes `verified` only after these deterministic checks pass:

- No output byte changes outside the hunks; output parses as CommonMark and preserves managed-block markers (ADR-0021, ADR-0022).
- Every output relative link and backticked path exists in the current tree or is explicitly marked historical.
- Every `reference_target_missing` reason in the finding is resolved.
- Every claim cites bundle evidence; otherwise return `claim_unbound`.
- Changed bytes stay within both 25 percent of the document and 4 KiB.
- Entrypoint size bounds and ADR-0206 protected README coordinates hold.
- The writing contract passes.

Candidates containing `statement` or `safety_or_policy` hunks, targeting user-owned documents, or using `archive` also require an ADR-0460 Tier 0 cross-check: "does each hunk follow from its cited evidence and change nothing else". `material_disagreement` rejects the candidate with contested claims; regenerate once, then raise attention. Add `document_freshness` to `DecisionPointSignal.kind`.

[ADR-0557](freshness/0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md) runs this Tier 0 in an independent no-capability session. When it is unavailable, the candidate records `crossCheck: unavailable` and the reason, holds every affected hunk as `verified_pending_cross_check`, and routes it to the owner. Owner approval substitutes for the missing cross-check; nothing in this state applies without it.

### 3. Authority and ownership

Determine change classes as follows:

- `factual_reference`: a path, symbol, version, command, or quantity whose new value appears byte-exact in cited evidence.
- `statement`: prose not reducible to a byte-exact copy.
- `safety_or_policy`: a hunk on a line matching safety patterns, an imperative instruction line in `AGENTS.md` or `CLAUDE.md`, or the Decision section of a decision record.

| Ownership | `factual_reference` | `statement` | `safety_or_policy` |
| --- | --- | --- | --- |
| Lervo-managed: `lifecycleOwner: lervo`, `lervo_exact`, `lervo_v1` managed blocks, `docs/knowledge/**` | auto-apply | auto-apply | owner |
| User-owned: `lifecycleOwner: user`, `reviewed_exact`, `repository_tool`, or no role | owner, or proxy under a `document_freshness` mandate | owner | owner |

Generation, verification, and cross-check require no authority and are budget-bounded. Only applying a user-owned hunk is a consequential effect. In `AGENTS.md` and `CLAUDE.md`, Lervo-managed block hunks use the ADR-0022 patch path; user-prose hunks follow the user-owned row. A candidate may apply partly and wait partly, and must report that state.

Narrowly amend ADR-0453: `PrincipalMandateV1.decisionKinds` may gain `document_freshness`, consequence class `repository_internal_reversible`. Under that mandate, the proxy approves user-owned `factual_reference` hunks and the knowledge convergence owner applies them, up to `maximumFreshnessApprovalsPerDay` (default 5). The proxy writes no bytes. Version 1 installs no such kind, per the owner decision below: every user-owned apply goes to the owner. User-owned `statement` and `safety_or_policy` hunks always wait for the owner. Argo's stale `v2` risk-limit line is `safety_or_policy`: it would produce a candidate within one cycle and an owner question in the next escalation batch, not an auto-apply.

Every apply records an event, informational attention item, turn-report line, Discord notice in the next batch window, and a commit by `Lervo Knowledge` carrying `Lervo-Freshness-Candidate: <candidateId>`.

Store before-bytes and their hash in CAS. `lervo knowledge freshness revert <candidateId>` restores them only if the current hash equals the candidate's after-hash; otherwise it fails with `revert_conflict` and prints the three-way instruction. Reverting sets `freshnessHold` for the finding digest, default seven days, so the loop does not contend with the owner. Applying requires the current hash to equal the candidate's source hash; otherwise mark the candidate `superseded` and regenerate next cycle.

### 4. Historical documents

Use `archive` when a document is superseded rather than correctable: its publication group is `historical`, a canonical successor names it as superseded, or most connected paths are deleted without a replacement. Move it to the layout's historical root (default `docs/archive/`), prepend a historical banner naming the date and current document, rewrite inbound links, and change no other byte.

User-owned archives use `relocation: reviewed_move` and wait for the owner; Lervo-managed archives auto-apply, subject to the cross-check requirement. ADR-0457 `retire_to_projection` continues to own evidence journals.

### 5. Surfaces and events

Add these operating attention kinds:

- `document_freshness_candidate`: user authority when owner approval is required.
- `document_freshness_applied`: informational; auto-resolves on acknowledgement.
- `document_freshness_blocked`: budget, repeated rejection, or zero successes.

Compact terminal context adds one line of at most 200 bytes only when counts are non-zero. The ADR-0459 turn report gains a documents segment. Owner approvals reach Discord through the ADR-0453 escalation batch; natural-language replies translate to `lervo knowledge freshness apply`. CLI: `lervo knowledge freshness status|review|apply|revert`, with plan and apply shaped like `lervo knowledge structure`, and `--json` support.

Six lifecycle events are `document.freshness.candidate.created`, `.verified`, `.applied`, `.rejected`, `.reverted`, and `document.freshness.cycle.completed`. They carry only relative paths, hashes, counts, codes, and identifiers; hunk and evidence bodies stay in CAS. The specification defines required fields.

Failure codes `claim_unbound`, `reference_unresolved`, `outside_bytes_changed`, `cross_check_disagreement`, `source_changed`, `freshness_budget_exhausted`, `revert_conflict`, and `freshness_hold_active` mean the candidate did not apply and the document is unchanged. `source_changed` also means a newer candidate follows.

## Acceptance

Reproduce Argo cases from Git history using fixture providers:

- F1: `AGENTS.md` points at a removed `v2` engine while `v4/argo4/live/engine.py` contains `class Limits`. Expect `safety` class, owner authority, and one candidate in the first cycle. Under ADR-0557, Tier 0 agreement leaves it waiting for the owner.
- F2: `README.md` has a broken `v2/README.md` link and "every 6 hours" against `v4/README.md` saying "daily". Expect `factual_reference`, proxy-eligible.
- F3: root `FINAL-DESIGN.md` references deleted handoff documents. Expect `archive`, a banner, and nine link rewrites.
- F4: an unrelated change yields no candidate; a correct document yields `no_change_needed`.
- F5: an owner edit during review yields `source_changed`.
- F6: apply then revert restores the hash and sets a hold.
- F7: a managed-block hunk applies through the ADR-0022 patch while a user-prose hunk in the same `AGENTS.md` waits.

The installed journey renames a referenced path in a scratch repository and commits. Within one change-driven cycle, a finding and verified candidate exist within budget; the owner or proxy approves; the apply commit carries evidence; and `lervo knowledge freshness status` reports time to fresh. The owner limits the installed journey to the Lervo repository.

Report metrics weekly from events:

| Metric | Definition or target |
| --- | --- |
| Time to fresh per priority class | p90 under 30 minutes to a verified candidate; under one escalation batch window to apply where a mandate exists |
| False-positive rate | `no_change_needed` plus owner rejections over candidates; below 10 percent |
| Acceptance rate | Applied over verified; above 70 percent |
| Tokens per applied update | At or below 40,000 |
| Revert rate | Below 5 percent |

## Delivery

1. `wired`: finding mapping, candidate, event, policy-key, and attention-kind schemas; `lervo knowledge freshness status` over rebuildable state.
2. `wired`: evidence bundle, governed generation, deterministic verification, CAS before-bytes, `review`, Lervo-managed auto-apply with commit, `revert`, and F1–F7 fixtures.
3. Partly `wired`: attention items, compact line, and owner apply, reject, and acknowledge. The turn-report segment, escalation question, and reply parser have no consuming host yet (ADR-0459, ADR-0453).
4. `wired` for edits by ADR-0557; archives are not cross-checked. The `document_freshness` signal awaits ADR-0460 Slice 1; metrics projection is deferred.
5. `wired`: `archive` operation.
6. Deferred by owner decision: `document_freshness` mandate kind.
7. `wired`; installed proof pending: the [document freshness specification's correction](../../../specifications/knowledge/document-freshness.md#installed-journey-completion) reports one local fixture-provider run on a copy of the Lervo repository. This does not establish real-provider installed completion. A real-provider run and its evidence document under `docs/evidence/quality/` remain open, replacing the former `installed-proven` label.

Also deferred: freshness of pending workstream approvals in compact context (recorded follow-up: a stale-hit marker under ADR-0459), non-Markdown sources, edits above the 25 percent bound, cross-repository evidence, and languages outside the English boundary (invariant 8).

## Owner decisions (2026-10-05)

1. Accept the authority matrix. While Tier 0 is unavailable, Lervo-managed `statement` hunks also wait for the owner because they require a cross-check. On 2026-11-02 the owner chose a separate Claude session as that cross-check (ADR-0557).
2. Exclude `document_freshness` from version 1 principal mandate kinds. Every user-owned apply goes to the owner; defer the kind until ADR-0453 Slice 2 provides the mandate contract.
3. Retain default safety patterns and the 150,000-token daily repository budget. Patterns match whole words without inflection; repositories add desired plural forms.
4. Run the installed journey only on Lervo. Do not touch Argo.

## Consequences

Stale references no longer depend on a human noticing. Costs are bounded provider spend, visible per update, and one new owner question per consequential stale document. Invariant 5 holds: user-owned bytes change only through exact, hash-bound, reversible approval. Invariant 3 holds: a verified candidate proves nothing until an apply event exists. Invariant 4 holds: candidates, holds, and bundles are rebuildable state under `.lervo/state`.
