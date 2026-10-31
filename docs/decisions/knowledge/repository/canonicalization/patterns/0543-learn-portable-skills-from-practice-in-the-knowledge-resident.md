# ADR-0543: Learn portable skills from practice in the knowledge resident

Status: `accepted`
Decision date: 2026-10-31
Implements: [background reusable-practice learning](../../../../../roadmap/knowledge/background-practice-learning.md)
Amends: [ADR-0458](../../../../execution/orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) (portable-skill entry), [ADR-0467](../../../documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) (capture input and output)

## Context

Lervo took Hermes's strength of learning from experience, but with evidence, review, and measurement ([Hermes differentiation](../../../../../research/lervo-product-positioning-and-verified-improvement/product-lessons/hermes-differentiation.md)). The first implementation never produced a skill:

- Across six repositories, the development-pattern pipeline recorded six observations, all from 2026-08-25 to 2026-09-03, and promoted no portable skill.
- It relied on an agent declaring a pattern at the end of a turn, gated by two independent verified source groups and exact contracts. Ordinary work never met that gate. [ADR-0533](0533-remove-the-development-pattern-pipeline.md) removes it.
- ADR-0458's single-observation candidates were decided but never built. No code records `learning.observation.recorded`.
- Nothing measured whether any skill was used. In `axli`, the hand-written `eli5` skill was not invoked in the 20 most recent Claude Code sessions.

Most owner turns are short directives in Korean, such as "implement it" or "continue". The reusable knowledge is in what the agent did, not in what the owner said. A design that waits for the owner to teach a procedure would produce almost nothing.

[ADR-0467](../../../documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) instruction capture already runs in the background. It queues each owner prompt with the preceding agent reply and assesses meaning with one no-capability provider call per turn. ADR-0542 records native skill invocations at `Stop`.

## Decision

Skills are learned in the knowledge resident from completed work, reviewed by an independent agent, materialized under the delegation's write scope, and re-evaluated by observed use. No turn declaration is involved, and the owner is not a review queue.

### Observe completed work, not only owner teaching

At `Stop`, the hook queues a bounded work record for the closing turn next to the ADR-0467 capture queue:

- the last assistant reply, up to 16 KiB;
- the turn's steps from the provider transcript: tool kinds, normalized executable identifiers for shell commands without arguments, repository-relative paths, and each step's success or failure where the transcript records it;
- repository revisions before and after, and content hashes of changed files at that time;
- verification outcomes observed in the turn, such as test or check commands and their exit status;
- a work digest: the hash of the provider session digest, turn digest, both revisions, and the transcript entry identifiers. A repeated `Stop` for the same turn has the same digest and is recorded once.

The next owner turn's capture call receives that work record with the owner's prompt. One provider call returns two independent fields:

- `captureClass`, unchanged from ADR-0467, for durable instructions, corrections, and decisions;
- `practice`: null, or a reusable procedure. A procedure has a goal, when to use it and when not to, inputs and preconditions, steps, how to confirm success, when to stop, and which parts are verified or only assumed.

If no owner turn arrives within 30 minutes, the resident assesses the work record alone in a practice-only call, under the skill-learning budget. The owner's input is never required.

When it arrives, the owner's reply counts as evidence. Acceptance, correction, or a request such as "make that a skill" changes confidence, not eligibility. A practice extraction failure never fails rule capture. Task-scoped one-off work returns `practice: null`.

A single completed, observed turn is enough for a candidate, as ADR-0458 requires. A turn whose outcome was not observed, or failed, cannot become a verified procedure; at most it is recorded as `verification_unavailable`.

### Evidence lasts until review

At assessment, a turn with a practice keeps a sanitized evidence bundle: the procedure fields, the step list, the outcome, the file hashes, and excerpts of the reply and of cited files. Lines the repository scanner classifies as secret are removed before the bundle is stored or sent to any provider. The bundle stays on the observing host until its candidate is resolved, or for 7 days. Review runs on the observing host against that bundle. Other hosts receive only the draft, hashes, and the resolution. A candidate not resolved within 7 days expires with `assessment_expired`.

### Shapes rank, they do not gate

Each work record also stores a practice shape: the ordered step kinds and normalized executables. Shapes are local, deduplicated by work digest, and kept for 30 days in a bounded store. A repeated shape raises a candidate's priority and confidence. It never creates a candidate by itself and is never required.

### Cover, extend, or propose

Before drafting, the resident compares the practice with installed skills and applied rules:

- `already_covered`: no change.
- `partial_overlap`: a delta proposal for the overlapping skill.
- `conflict`: held as `unresolved` with both sources.
- `new`: a new skill draft.

Lervo changes only skills it generated and that nobody has edited since. It records the expected current hash and refuses to write if the file changed. A hand-written, external, or edited skill is never modified; Lervo records a proposal for it instead.

### Draft and independent review

The resident drafts one `SKILL.md` in the Agent Skills format: `name`, `description`, then the procedure fields above. The draft is at most 8 KiB, cites only repository paths that exist at the observed revision, and declares no tools or permissions.

An independent reviewer agent decides. The reviewer runs in a separate session and agent identity from the drafter; using the other admitted provider is an additional safeguard, not the guarantee. It checks:

- when to invoke the skill and when not to;
- what practical knowledge it adds beyond existing rules and skills;
- that inputs, preconditions, success confirmation, and stop conditions are present;
- that verified steps and assumptions are distinguished;
- grounding in the work record, no secret or host-specific value, and no granted capability.

A review binds the draft hash, the work-record evidence hashes, the target file's current hash, and the rule and skill catalog digest. Rejections carry a reason:

- `not_reusable` and `duplicate` close the observation.
- `incomplete` and `ungrounded` allow one redraft when new evidence for the same practice arrives.

### Authority

Each effect has its own authority:

| Effect                                                                   | Authority                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture, drafting, and review                                            | The convergence delegation's read and provider budget.                                                                                                                                                                     |
| Writing `.agents/skills/<name>/SKILL.md`                                 | The delegation's write scope. It must include `.agents/skills` in `normalizationRoots`, under [ADR-0473](../../../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md). |
| Creating `.claude/skills/<name>` as a link to the portable skill         | Only when `.claude/skills` is in the delegation's write scope, the link is new, and no user-owned entry exists at that path.                                                                                               |
| Committing on the integration ref and opening the knowledge pull request | The existing publication delegation.                                                                                                                                                                                       |
| Merging                                                                  | The owner's normal merge, as for every knowledge output.                                                                                                                                                                   |

When a required root is missing from the delegation, the candidate waits with `publication_authority_missing`. That root is proposed through the existing scope-change decision, once for all waiting skills. Codex discovers `.agents/skills` on its own, so no Codex link is created.

### Keep, re-evaluate, or retire by observed use

ADR-0542 observations and managed-run `skill.invoked` receipts are combined, each keeping its evidence level. Every skill version has one usage state:

- `used`: an invocation was observed since the version was exposed.
- `unused_with_coverage`: no invocation, while invocations were observable for every provider and host that ran turns in the repository.
- `unknown`: any provider, host, or surface without coverage, or exposure not yet confirmed.

The window starts when the version is confirmed exposed: the file is present on the integration target and the provider loaded it, where observable. Usage aggregates (counts, last observed time, coverage) are exchanged per host.

A Lervo-generated skill that is `unused_with_coverage` for 30 days after at least 20 observed turns is re-evaluated by the reviewer agent. The reviewer also weighs how often its trigger situation occurred in observed work. A skill for a rare task, such as a quarterly release, is kept. The reviewer may retire it, through the same write and publication path. `unknown` never leads to retirement. A hand-written skill is never proposed for removal on missing observation; only `unused_with_coverage` for 90 days lets it appear as an informational health item.

### Hosts and Hub

- **Observe and assess where the turn ran.** Work records, shapes, and transcript excerpts never leave the observing host. Assessment needs no owner lease, as in ADR-0467.
- **Exchange typed candidates.** Hub-coordinated hosts exchange candidates, reviews, resolutions, and usage aggregates on `/v1/sync/projects/{projectId}/knowledge-skill-candidates`. Records hold drafts, hashes, digests, and provenance, never work-record text. Candidates with the same practice and different names merge by the reviewer's catalog comparison.
- **Write on the convergence owner.** Only the [ADR-0466](../../../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) owner materializes and commits.
- **Without a Hub,** a standalone host assesses, reviews, and writes locally under its own delegation.

### Budget

Skill learning has its own daily budget under the host provider budget, below rule capture in priority:

- at most 3 drafts and 3 reviews per repository per day, counting retries and retirement reviews;
- at most 120,000 tokens per day across repositories on a host.

Tokens added to a capture call by the work record count against the skill-learning budget, not the capture budget. Input and output tokens are reserved before each call. An unobserved usage keeps its reservation. The added capture input is bounded at 24 KiB per turn. Skill learning waits whenever rule capture or foreground work needs the provider.

## Events, states, privacy, and failure meaning

Candidate states:

- `observed`
- `assessed`
- `drafted`
- `reviewed_accepted`, `reviewed_rejected`
- `materialized`
- `published`
- `exposed`
- `used`
- `retired`

Events:

- `knowledge.skill_candidate.proposed`: `candidateId`, `practiceDigest`, `workDigests`, `overlap` (`new | partial_overlap | conflict`), `targetSkill` or null, `draftHash`, `occurredAt`.
- `knowledge.skill_candidate.resolved`: `candidateId`, `decision`, `reasonCode`, `reviewerAgentId`, `reviewedDraftHash`, `catalogDigest`, `occurredAt`.
- `knowledge.skill.usage_assessed`: `skillName`, `versionHash`, `usageState`, `observedTurns`, `coverage`, `occurredAt`.
- `knowledge.skill.retired`: `skillName`, `versionHash`, `retirementCommit`, `occurredAt`. It is recorded only after the removal commit lands on the integration target. A pending retirement is a candidate state, not this event.

Materialization and publication reuse existing knowledge materialization and publication events, linked by commit and hash.

Failure codes:

| Code                            | Meaning                                     | Retry                                   |
| ------------------------------- | ------------------------------------------- | --------------------------------------- |
| `source_incomplete`             | The work record was truncated or missing.   | Retryable with new evidence.            |
| `verification_unavailable`      | No observed outcome.                        | Not promotable from this turn.          |
| `review_invalid`                | The review did not bind the current hashes. | Retried.                                |
| `target_changed`                | The skill file changed before writing.      | Re-assessed.                            |
| `publication_authority_missing` | The delegation lacks the root.              | Waits for scope.                        |
| `usage_coverage_unknown`        | Coverage is incomplete.                     | Blocks retirement.                      |
| `provider_not_admitted`         | No admitted provider.                       | Waits.                                  |
| `assessment_expired`            | Not resolved within 7 days.                 | Closed; the evidence bundle is deleted. |

Privacy:

- Work records live in `.lervo/state/knowledge/practice/`: Git-ignored, 0600 files in 0700 directories, A record without a practice is deleted at assessment. Evidence bundles follow the retention above. Shapes keep only step kinds, executable identifiers, and digests. Tests cover the same permissions on macOS and Linux.
- Provider input is limited to repository paths inside the delegation's read roots, excludes paths the scanner classifies as private or secret, follows no symlink out of the repository, and is capped at 8 KiB per file and 32 KiB per candidate.
- Executable identifiers are normalized to a name without directories.
- Events carry identifiers, hashes, digests, and published skill paths only.

### Funnel measurement

The resident records daily counts and drop reasons at each step: observed, assessed with practice, drafted, accepted, materialized, published, exposed, used. A month with no skill then shows where the funnel stopped.

## Verification

Focused tests must show:

- an ordinary directive turn with an observed successful outcome yields a practice candidate without any owner teaching, and a one-off or failed turn does not;
- one capture call returns an unchanged rule capture and a separate practice, and a practice failure leaves rule capture intact;
- `already_covered` changes nothing, `partial_overlap` proposes a delta only for an unedited Lervo-generated skill, and a hand-written skill is never modified;
- the drafting agent cannot review its own draft, reviews bind the stated hashes, and rejection reasons close or reopen as specified;
- missing write roots wait with `publication_authority_missing`, and a `.claude/skills` entry is never overwritten;
- `unknown` coverage never retires, and `unused_with_coverage` triggers re-evaluation rather than deletion;
- two hosts observing the same practice produce one merged candidate, and a standalone host completes locally;
- reservations hold when usage is unobserved, and the funnel records each drop reason;
- a work record with no following owner turn is assessed after 30 minutes;
- the reviewer reads the retained, sanitized evidence bundle, and secret lines never reach a provider.

Installed verification must show, on Mac and WSL, a skill learned from ordinary directive work without a teaching or request prompt, reviewed by a separate agent, published through a knowledge pull request, and later invoked.
