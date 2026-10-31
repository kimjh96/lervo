# Practice learning contract

This specification holds the states, events, failure codes, privacy rules, and funnel measurement for [ADR-0543](../../decisions/knowledge/repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md), which learns portable skills from completed work in the knowledge resident.

## States and events

Candidate states:

- `observed`
- `assessed`
- `unresolved`: conflicting sources are retained for catalog re-evaluation.
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

## Failure codes

| Code                            | Meaning                                                       | Retry                                         |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `source_incomplete`             | The work record was truncated or missing.                     | Retryable with new evidence.                  |
| `verification_unavailable`      | No observed outcome.                                          | Not promotable from this turn.                |
| `review_invalid`                | The review did not bind the current hashes.                   | Retried.                                      |
| `target_changed`                | The skill file changed before writing.                        | Re-assessed.                                  |
| `publication_authority_missing` | The delegation lacks the root.                                | Waits for scope.                              |
| `usage_coverage_unknown`        | Coverage is incomplete.                                       | Blocks retirement.                            |
| `provider_not_admitted`         | No admitted provider.                                         | Waits.                                        |
| `assessment_expired`            | Not resolved within 7 days.                                   | Closed; the evidence bundle is deleted.       |
| `practice_budget_exhausted`     | The skill-learning reservation or attempt bound is exhausted. | Wait for the next budget window.              |
| `assessment_failed`             | A practice operation failed without an assessment result.     | Retry under the attempt and retention bounds. |
| `foreground_pending`            | Foreground work needs the provider.                           | Wait for idle admission.                      |

## Privacy

- Work records live in `.lervo/state/knowledge/practice/`: Git-ignored, 0600 files in 0700 directories, A record without a practice is deleted at assessment. Evidence bundles stay on the observing host until their candidate is resolved, or for 7 days, as ADR-0543 "Evidence lasts until review" decides. Shapes keep only step kinds, executable identifiers, and digests. Tests cover the same permissions on macOS and Linux.
- Provider input is limited to repository paths inside the delegation's read roots, excludes paths the scanner classifies as private or secret, follows no symlink out of the repository, and is capped at 8 KiB per file and 32 KiB per candidate.
- Executable identifiers are normalized to a name without directories.
- Events carry identifiers, hashes, digests, and published skill paths only.

## Funnel measurement

The resident records daily counts and drop reasons at each step: observed, assessed with practice, drafted, accepted, materialized, published, exposed, used. A month with no skill then shows where the funnel stopped.

## Source implementation

The terminal hooks retain their ADR-0542 contract. The resident shares one verified range read with native skill observation. Repository revisions and changed-file hashes come from the Stop change manifest. It never replaces these hashes with a later working-tree observation. Missing or truncated evidence cannot create a verified procedure. Codex skill-use coverage remains unknown.

The capture response adds nullable `practice` beside the unchanged `captureClass` contract. Invalid practice leaves the rule result intact. The legacy capture queue has no session field. The resident attaches preceding work only when the prompt digest, provider and capture time identify one prepared context. Ambiguous matches remain eligible for the 30-minute local assessment.

Evidence uses scanner exclusions, the delegation parent's read scope and shared credential classification. Secret lines and host-specific home paths are removed before retention or practice-provider input. Changed-file excerpts require the observed content hash. Unchanged excerpts require a regular Git blob at the Stop commit. Each excerpt is at most 8 KiB. Evidence remains private on the observing host.

The private projection bounds work records at 128, retained evidence at 64, shapes at 2,048, assessment tombstones at 1,024 and daily funnel rows at 32. Shapes expire after 30 days. Unresolved evidence expires after seven days. Generated-version metadata stays bounded at 1,024 entries. Capacity bounds grant no extra authority.

Drafting compares installed skills and applied rules by meaning. Repeated shapes inform ordering and review confidence. They never gate candidates. Provider catalog context contains skill and rule entries with their digest. The scanner inventory and read-root coordinates stay local. `already_covered` closes the observation. `partial_overlap` retains a delta proposal. A hand-written or edited skill stays unchanged. Only an exact generated-version hash permits an update. Conflicts wait as `unresolved`. An incomplete or ungrounded rejection permits one redraft after a new work digest arrives. Other rejections close the observation.

The generator and reviewer use separate workforce agent identities and leased sessions. Pinned read-only assignments retain the ordinary role, capability, ancestry and path-conflict checks. Reviews bind the draft, retained evidence, target preimage and complete catalog. Accepted writes reuse the durable knowledge journal, verified workspace integration and the existing knowledge publication commit path. A missing `.agents/skills` normalization root creates one workstream scope decision for all waiting skills. It does not expand the delegation. Claude links are created only under a delegated root and only at an absent path.

Every new practice event, including `learning.observation.recorded`, requires event schema 8. The existing activation planner checks every configured reader before enabling the writer. Event payload schemas reject work text and unknown fields. Deterministic expiry may resolve a candidate without a reviewer; `reviewerAgentId` and `reviewedDraftHash` are then nullable. `coverage` is `complete` or `unknown`.

The host skill-learning ledger reserves input and output before each call. It counts retries and retirement reviews toward the daily three-draft and three-review bounds. Missing usage retains the reservation. Added capture work is charged to the skill-learning ledger; the shared call still has one provider-reported usage receipt. Foreground work and pending rule capture take priority. Practice calls share resident call admission and the provider pause mechanism.

Usage joins native observations by exact path and hash. Managed `skill.invoked` receipts require a matching `skill.resolved` hash in the same run and session. The projection keeps the two evidence levels distinct. A missing exposure observation, missing turn assessment, Codex coverage, another unobserved surface or unavailable host coverage keeps usage unknown. Re-evaluation requests review after 30 days and 20 covered turns. It grants no deletion authority. The reviewer keeps rare tasks and insufficient trigger-frequency evidence. Hand-written skills can produce health information only after 90 days of covered non-use.

The standalone source path is wired. Hub candidate and usage exchange remains the single [bounded exchange follow-up](../../roadmap/knowledge/background-practice-learning.md#bounded-exchange-follow-up). Hub-coordinated hosts still assess and review locally. Only the convergence owner writes. Hub usage cannot become complete before typed host aggregates are implemented. Mac and WSL installed acceptance remains pending. Focused tests were written and were not run.
