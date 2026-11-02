# Core health signal slice 1: delivery evidence

Label: `wired`. Installed acceptance remains open.

## Evidence boundary

Task base and current Git HEAD: `b4979c90cd127aa0f4c0633119bf3c4453b6efc7`.
Source changes remain uncommitted on `core-health-signal-slice-1`.
The existing installed CLI is `0.22.4`; the local candidate build retains that
version with a pending minor release intent. No installation, publication,
manifest/SBOM update or commit was performed.

The adversarial rework uses one final workspace build. Its exact source and
artifact binding is recorded in the rework evidence below. The earlier draft's
8,380,828-byte hook and `7161be18fd259737f7f301134ce1c1c7d63dc127f8976efab3fad5c62f0695e7`
hash describe an earlier artifact. At rework entry, the artifact was instead
8,380,637 bytes with SHA-256
`354303d766d3d5b71558919cfa92f9b33059740648ebd0b93de916a4abfae13a`,
matching the review. Neither historical artifact is the final rework build.
Focused and regression tests are written but **not run**, as requested.
No provider was called for this rework.

The historical comparison below uses the base-revision compact coordinator and formatter
and the candidate's built coordinator, both against this worktree's current
private state, the same synthetic prompt and the same declaration placeholder:
`Local diagnostic: no completion claim.` The base TypeScript was executed with
Node's type stripping, without another build or test run. This is renderer
comparison evidence, not an installed turn or a completed acceptance cohort.

Unlike the owner's existing installed repository, this new worktree has no
maintenance observation, staleness report or freshness cycle. Its old renderer
therefore had no freshness/capture chore lines. The new renderer exposes those
missing sources. The supplied 71/186/1,504 baseline was not copied into local
state or presented as a current observation.

Historical projection observed at `2026-10-31T02:31:45.452Z`, repository snapshot `sha256:d1c1eec65455fa60a536fdc0497eb9b5e15f2f943a1fa69ab13145b22b85ecb0`.
The displayed health section is **571 UTF-8 bytes**. Its two omitted
lines are owner-review coverage and the missing current-revision link-count
cache; the application JSON retains both measures. The Find zeros mean no
matching recorded local events in the complete bounded window; last injection
itself remains unknown.

## Exact renderer text before

```text
Lervo compact terminal context. Before changing repository bytes, run `lervo knowledge query "<purpose and paths>"` for applicable rules, as AGENTS.md requires.
Repository publication policy: publication.language=en; writingPolicyId=writing_en-human. Write new or revised repository documentation in English, even when the request or conversation is in another language, unless the user explicitly requests an exception. This policy does not choose the chat response language or authorize translation of unrelated user-owned content.
Local diagnostic: no completion claim.
If this turn changes repository-authored bytes, record the next bounded revision with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; the service sets revision, update time, and HEAD. Never ask the user to run bookkeeping.

Applied owner rules: 3 complete clauses prepared; provider delivery unobserved.

Lervo applied owner rule (applicable; docs/instructions/generated/rule_304aa2496fe08f7935fb1c8c.md; sha256:aeceb62977eb76c3b4f5c87be31d1f8176444fbce09d4b648be8847074e13f46):
---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_304aa2496fe08f7935fb1c8c
    authority: explicit_user
---
# Automatic cross-host knowledge maintenance for future projects

Ensure newly created projects also receive automatic repository knowledge maintenance on either Mac or WSL without interrupting the owner's development workflow.


Lervo applied owner rule (applicable; docs/instructions/generated/rule_f5f3724fc3ec2813038a99e4.md; sha256:95d1fa91eb3403e32d71a1728cab924418572b7188f05b0a19152f2d5ed6f355):
---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_f5f3724fc3ec2813038a99e4
    authority: explicit_user
---
# Resolve cross-host conflicts through coordination, not host restriction

When Lervo features conflict between a Mac host and a WSL Hub host, do not propose or apply restricting Lervo to one host as the solution. Lervo must behave identically on whichever host work occurs. Treat these conflicts as cross-host coordination problems and resolve them through coordination.


Lervo applied owner rule (applicable; docs/instructions/generated/rule_fff5d663820c1552b490f670.md; sha256:4dc801fba34a151b156a4d65aeae4e084f08667bb696fdc09e6cb040a8b24843):
---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_fff5d663820c1552b490f670
    authority: explicit_user
---

# Use Korean for owner-facing responses.

Respond to the owner in Korean.


Lervo workstream: Core health signal slice 1: Know and Find (revision 1).
Next: Predeclare the 7-day installed journey and inspect existing background and attention sources.
```

## Exact renderer text after

```text
Lervo compact terminal context. Before changing repository bytes, run `lervo knowledge query "<purpose and paths>"` for applicable rules, as AGENTS.md requires.
Repository publication policy: publication.language=en; writingPolicyId=writing_en-human. Write new or revised repository documentation in English, even when the request or conversation is in another language, unless the user explicitly requests an exception. This policy does not choose the chat response language or authorize translation of unrelated user-owned content.
Lervo health: Find last context.injected unknown (none recorded); context.referenced 0/7d; terminal.context.prepared 1/7d; owner: context preparer. [projection age 0m]
Lervo health: 3 upkeep items; owner: resident/reviewers; lervo application attention --json.
Lervo health: convergence unknown (maintenance_observation_missing_or_invalid); owner: resident.
Lervo health: longestStop unknown (stop_start_unrecorded); owner: resident.
Lervo health: freshness unknown (staleness_report_missing); owner: resident.
Lervo health: omitted 2; lervo application attention --json.
Local diagnostic: no completion claim.
If this turn changes repository-authored bytes, record the next bounded revision with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; the service sets revision, update time, and HEAD. Never ask the user to run bookkeeping.

Applied owner rules: 3 complete clauses prepared; provider delivery unobserved.

Lervo applied owner rule (applicable; docs/instructions/generated/rule_304aa2496fe08f7935fb1c8c.md; sha256:aeceb62977eb76c3b4f5c87be31d1f8176444fbce09d4b648be8847074e13f46):
---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_304aa2496fe08f7935fb1c8c
    authority: explicit_user
---
# Automatic cross-host knowledge maintenance for future projects

Ensure newly created projects also receive automatic repository knowledge maintenance on either Mac or WSL without interrupting the owner's development workflow.


Lervo applied owner rule (applicable; docs/instructions/generated/rule_f5f3724fc3ec2813038a99e4.md; sha256:95d1fa91eb3403e32d71a1728cab924418572b7188f05b0a19152f2d5ed6f355):
---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_f5f3724fc3ec2813038a99e4
    authority: explicit_user
---
# Resolve cross-host conflicts through coordination, not host restriction

When Lervo features conflict between a Mac host and a WSL Hub host, do not propose or apply restricting Lervo to one host as the solution. Lervo must behave identically on whichever host work occurs. Treat these conflicts as cross-host coordination problems and resolve them through coordination.


Lervo applied owner rule (applicable; docs/instructions/generated/rule_fff5d663820c1552b490f670.md; sha256:4dc801fba34a151b156a4d65aeae4e084f08667bb696fdc09e6cb040a8b24843):
---
lervo:
  durableInstruction:
    schemaVersion: 1
    ruleId: rule_fff5d663820c1552b490f670
    authority: explicit_user
---

# Use Korean for owner-facing responses.

Respond to the owner in Korean.


Lervo workstream: Core health signal slice 1: Know and Find (revision 1).
Next: Predeclare the 7-day installed journey and inspect existing background and attention sources.
```

## Information movement

| Previous compact item                                   | New compact location                                                          | Full inspection and actor                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Document freshness: N stale`, safety count/path        | Freshness gap or explicit unknown                                             | `health.measures.freshness`: evaluated denominator, unevaluated and unknown counts, independent cycle stale/safety/path summary; resident freshness cycle. |
| Freshness candidates awaiting review                    | Owner batch only for structured consequential effects; otherwise upkeep count | `document_freshness_candidate` items retain candidate, path, classes, hunk count, creation/age, inspect command and original instruction.                  |
| Freshness `blocked`                                     | Freshness value and upkeep count                                              | `document_freshness_blocked`, owned by resident freshness cycle.                                                                                           |
| Freshness `refreshed`                                   | Ordinary attention apply notice                                               | `document_freshness_applied`, including exact path/revert/acknowledgement guidance; informational and agent-owned.                                         |
| `Instruction capture: ... candidate ...`                | Upkeep count                                                                  | `durable_instruction_candidate`, normalized title/source/hash/path and inspect command; knowledge resident (ADR-0561).                                     |
| `Instruction capture: ... held owner decision or rule`  | Upkeep count                                                                  | `captured_decision`, captured time/age, title and original instruction; knowledge resident as Lervo debt (ADR-0561).                                       |
| Capture blocked for missing delegation                  | Upkeep count (Lervo debt under ADR-0561)                                      | `instruction_capture_blocked`, queued count, since/age, recommendation and exact delegation inspect command.                                               |
| Applied owner rules                                     | Existing full instruction preamble                                            | Rules and their exact hashes remain prepared separately.                                                                                                   |
| Generic owner-labelled convergence/publication recovery | Convergence health and upkeep count                                           | Original typed attention fields and `recordedInstruction`; resident or knowledge publisher.                                                                |
| Consequential pending approvals/scope decisions         | One owner-authority batch                                                     | Each item retains recommendation, consequence and exact inspect command; excess items have an omitted count.                                               |

The shared command is `lervo application attention --json`; its `health` field
is the same file projection used by compact turns. All ordinary typed items
remain available, including their original source guidance. Responsibility
attribution does not grant a reviewer, resident or proxy authority to write.

## Installed hook limitation

The existing installed CLI, existing generated runtime and local candidate
hook diagnostics all returned exactly:

```json
{}
```

A diagnostic stage observer localized the failure to `lifecycle_inspection`:
`EPERM` while changing permissions on the common Git directory's
`lervo-coordination-v1`, outside this sandbox's writable worktree. The failure
precedes prompt preparation. No provider was called and no attempt was made to
change permissions outside the authorized workspace. The renderer comparison
above does not prove hook egress, provider delivery or owner receipt.

The current retained terminal receipt is `tobs_6379e487634b49019baf0d0b75af0f3e`
(event `evt_6b50892efb084207a3eda43e4ab69c04`), from the earlier installed build;
it is not candidate-build evidence. Candidate installed turn IDs, receipt
hashes, the 20-turn-per-host denominator, the seven-day window and Mac/WSL
installed parity are **unknown / not collected**. See the
[predeclared journey](core-health-signal-slice-1.md).

## Discord

Not wired. `apps/node-runtime/src/discord-conversation-mode.ts` supplies only
workstream title, objective and status to intent resolution.
`discord-conversation-response-composition.ts` composes read/work responders,
continuations, effect results and deliberation signals. It has no consumer of
operating attention and no general per-turn status footer. Specialized
`conversation-deliberation-signal-responder.ts` messages concern deliberation
publication, not repository health. No natural existing operating-attention
insertion point was found. This slice adds no Discord feature. A later surface
must consume the existing application attention command, not a separate health
path, and supply a real guild journey.

## Remaining observations

Existing stage records do not record attention appearance, and existing route
plans do not record deferral first-seen time. Reported/unreported durations and
deferral ages remain unknown where their sources cannot establish them. The
existing lifecycle lint cache contains validity but no link count; broken links
remain unknown. No new instrumentation was introduced to fill these gaps.

## Repository lifecycle boundary

The explicit migration inspection is `ready`, and explicit knowledge lint is
`valid: true` with 150 existing advisory findings. They include stale documents,
normalization, missing generated materialization and a missing link. The full
refresh plan would create 79 generated publication pages outside this slice;
it was left unapplied. Only the three bounded private inventory, source-unit
and impact read models are refreshed through the existing public projection
contract. Full repository lifecycle readiness remains distinct from that refresh
and from the minor release-intent completion result.

## Historical rendering against the owner's real state, after lead review

Claude reviewed the draft and reworked the renderer:

- unknown measures collapse into one line;
- raw counters stay in the attention JSON;
- the per-turn upkeep count leaves the prompt;
- durations read in minutes, hours, or days;
- a current stop is shown once;
- a missing recovery is stated as `none recorded` instead of an assumed readmission.

The section cap is 520 bytes.

The candidate build computed the projection for the installed `lervo` checkout on the Mac at 2026-10-31 02:44 UTC. Prefetch took about 3.5 s, off the prompt path.

Before: the installed 0.22.4 prompt context on the same checkout.

```text
Document freshness: 74 stale (17 safety: docs/specifications/knowledge/document-freshness/operations.md), 1 candidate awaits review, blocked; lervo knowledge freshness review
Instruction capture: 1 held owner decision or rule. Tell the owner; details: lervo knowledge instruction status and lervo knowledge instruction capture.
```

After: 428 bytes.

```text
Lervo health: knowledge stopped 42h (knowledge_compile_policy_violation); resident; recovery: none recorded (lervo knowledge convergence status). [age 0m]
Lervo health: 71/186 evaluated documents stale, 1503 unevaluated; freshness cycle.
Lervo health: Find unproven (last injection 52d ago; 0 references in 7d); context preparer.
Lervo health: unknown: longestStop, ownerReview, brokenLinks (lervo application attention --json).
```

The first line exposes a stop that the installed context never reported: Mac convergence had been stopped for 42 hours with `knowledge_compile_policy_violation`. The held decision `kcap_031dca0fcd513ca7fd0347b8` is upkeep, not a consequential effect, so it moved out of the prompt into the attention JSON.

## Adversarial rework

All twelve findings were confirmed. Findings 1–7 and 9–12 are corrected; finding
8 is corrected only for the new background path, as adjudicated. The renderer
keeps its line structure, 520-byte cap, one collapsed unknown line and concise
signal text. No raw event counter dump or per-turn upkeep count was restored.

| Finding | Final behavior and regression evidence                                                                                                                                                                                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Missing reporting renders `reporting unknown`; missing local injection renders `last recorded injection unknown`. Renderer regression covers both.                                                                                                                                                                                                                          |
| 2       | `hub_forbidden` retains owner scope authority; `hub_unauthorized` and `token_file_unreadable` retain credential authority. Knowledge delegation does not grant these effects. The classification table covers all 15 kinds plus credential, scope and stale exceptions.                                                                                                     |
| 3       | `formatCompactTerminalPreamble` merges currently read approvals with cached owner effects. It replaces cached workstream entries, deduplicates IDs and retains a single batch when the cache is missing, stale or revision-invalid. Regression also removes resolved cached approvals.                                                                                      |
| 4       | `documentFreshnessAttentionSources` no longer cuts candidates before classification. The 256-item report cap follows full classification and totals; per-kind counts, omissions and exact inspect commands survive. Tests place an owner write after 16 upkeep candidates and beyond the return cap, and verify a 300-owner health count with 32 summaries and 268 omitted. |
| 5       | Freshness evaluation and cycle summary have separate timestamps and expiry. Missing, changed-HEAD or expired evaluation preserves cycle stale/safety counts and first safety path. Reader and projection cases cover independent expiry.                                                                                                                                    |
| 6       | Old, future or unobserved capture/cycle owner evidence is excluded from the current batch. Incomplete total counts are null; `confirmedCount` names the verified portion. A valid upkeep item cannot imply zero owner effects. Source deadlines also bound cached owner validity.                                                                                           |
| 7       | The health reader separately reads the current bounded resident heartbeat. The same live resident state preserves convergence across a 15-minute reconciliation interval; missing, stale or changed hosting is unknown. Tests also cover future Find and stop events.                                                                                                       |
| 8       | Background inspection uses `readHealthWorkstream`, a 64 KiB current-state read and at most 10,001 typed provenance events. It never calls recovery. Tests cover missing current state and overflow. The older compact path remains unchanged; see the bounded follow-up.                                                                                                    |
| 9       | Computation claims a per-checkout SQLite generation before source reads. The generation check and atomic rename share one write transaction. Tests model overlapping computations and an old result finishing after a newer same-revision result.                                                                                                                           |
| 10      | Stale items keep their existing re-verification instruction, including for consumers unaware of `recordedInstruction`. Both the classification regression and existing stale-workstream suite cover the contract.                                                                                                                                                           |
| 11      | The prompt expectation now matches `1/10 evaluated documents stale`. Regression suites additionally cover skipped, failed and rejected cycle refresh after heartbeat writes. No test was executed.                                                                                                                                                                          |
| 12      | Historical bundle evidence is separated above; the final rework artifact is bound below to the exact uncommitted build inputs.                                                                                                                                                                                                                                              |

Source responsibilities were reviewed against the code convention. Pure
freshness evaluation, source-valid owner aggregation and unknown-measure
construction are separate from I/O. The workstream observer owns bounded
provenance reads; publication owns generation fencing and atomic persistence;
the reader owns validation and live heartbeat reads; the renderer remains pure.
Existing CLI and runtime entrypoints compose these concerns. Touched production
modules are below the long-module threshold and introduce no structural deferral.

The focused suites are `operating-attention-ownership.test.ts`,
`repository-health.test.ts`, `repository-health-projection.test.ts`,
`repository-health-prompt.test.ts`, `repository-health-owner-batch.test.ts`,
`repository-health-freshness-attention.test.ts`,
`repository-health-workstream.test.ts`, and runtime `loop-health.test.ts`.
They are included by the repository Vitest glob and remain **unrun**. No executed
regression or installed acceptance claim follows from type analysis or build.

## Bounded follow-up: compact workstream provenance

The working agent for the next compact-context slice must replace the existing
`prepareCompactTerminalPromptContext` → `verifiedCurrentWorkstream` path.
`latestWorkstreamEvent` scans all event pages; `hasReplicatedWorkstreamOrigin`
can scan them again, and `verifiedCurrentWorkstream` can call
`restoreCurrentWorkstreamState` when the current file is missing. The exact
implementation is `apps/cli/src/workstream-services.ts`, called by
`apps/cli/src/terminal-compact-context.ts`. This pre-existing path is deliberately
unchanged in this rework. No claim that the entire compact prompt is scan-free
or recovery-free is supported.

Bound this follow-up to current-snapshot verification and provenance lookup.
Preserve existing freshness and exact-origin checks; move any recovery to an
explicit background owner. Verify a history above 10,000 events, missing current
state, imported origin with absent local source artifact, corrupt snapshot/event
binding, no prompt-side writes, unchanged current approval visibility, and the
4,096-byte complete context cap. Measure installed prompt latency on Mac and WSL.

## Final rework build and verification

The single rework command was `pnpm build` and exited 0. No second build,
installation, provider call, manifest/SBOM update or commit was performed.

| Binding                | Final observation                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task base / build HEAD | `b4979c90cd127aa0f4c0633119bf3c4453b6efc7` on `core-health-signal-slice-1`; source remains uncommitted.                                                                                                                                                                                                     |
| Source input set       | 4,787 unique regular repository files from `git ls-files --cached --others --exclude-standard -z`, limited to `apps/`, `packages/`, `scripts/` and root-level files, sorted by relative path. Ignored build outputs are excluded.                                                                           |
| Source binding         | SHA-256 `5eec819ea357d1235741b4a97914609183d8df3a2a28008aaf9658227f25d0bd` over the UTF-8 manifest: each line is the file's lowercase SHA-256, two spaces, its relative path and LF. All bound bytes and set membership were identical before and after the build. Subsequent edits are documentation only. |
| Final hook             | `apps/cli/dist/terminal-hook.js`: **8,388,139 bytes**, SHA-256 `f33388451ed9941fbf990dd84110e33cc5a22b3ef63010b06489ae49bb1e853f`. The 8,388,608-byte cap passed, with 469 bytes remaining.                                                                                                                 |
| CLI loader             | `apps/cli/dist/bin.js`: 967 bytes, SHA-256 `38a3547b685482a0c7a0f8b29e100201e4262d7ea9ae100b147822faaf3a47e4`. This loader is not a substitute for the hook hash or installed receipt evidence.                                                                                                             |

`pnpm quality:check`, `pnpm typecheck`, `pnpm architecture:check`,
`pnpm docs:check` and
`pnpm release:completion:check --base b4979c90cd127aa0f4c0633119bf3c4453b6efc7`
passed. Release completion is `intent_pending` under the existing minor intent;
it does not prove release publication or installed acceptance. `git diff --check`
passed. The source responsibility review above accompanies the automated checks.
Tests remain **written, not run**.

Migration inspection returned `ready`; explicit knowledge lint returned
`valid: true`. The full refresh plan still includes 79 generated publication
pages outside this slice and was not applied. Private inventory, source-unit and
impact read models are refreshed separately through the public projection
contract. Existing normalization and document advisories remain separate from
health-source truth and release readiness. The seven-day installed journey,
20 turns per host, exact turn/receipt bindings and Mac/WSL parity remain open;
completion remains `wired`.

The final declaration's initial `knowledgeDisposition: refreshed` was rejected
by the existing `repository_knowledge_ready` and `document_normalization_pending`
lifecycle gates. Refreshing the three private read models does not satisfy those
broader gates. The declaration therefore records `pending_user_approval` for
knowledge lifecycle, preserving the existing exact-review boundary for any
additional repository-document writes. Resident maintenance owns preparing that
bounded review; no broader generation or normalization was applied in this task.
Canonical health sources are updated; full repository knowledge currency is not
claimed.

## Hook bundle correction after review

The fixed draft computed the projection in the detached post-Stop prefetch as well. That pulled the whole projection into the terminal hook bundle: 8,388,139 bytes, 469 bytes under its 8 MiB budget. Only resident reconciliation now computes the projection:

- the host resident;
- `lervo knowledge worker --watch`, through an option that the full CLI passes and the hook runtime does not.

The hook keeps only the reader and formatter. The rebuilt `apps/cli/dist/terminal-hook.js` is 8,365,998 bytes, against 8,353,989 bytes on `main`.

Without a running resident, the prompt shows the measures as `unknown` instead of computing them on the prompt path.
