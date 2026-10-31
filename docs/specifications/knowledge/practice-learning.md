# Practice learning contract

This specification holds the states, events, failure codes, privacy rules, and funnel measurement for [ADR-0543](../../decisions/knowledge/repository/canonicalization/patterns/0543-learn-portable-skills-from-practice-in-the-knowledge-resident.md), which learns portable skills from completed work in the knowledge resident.

## States and events

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

## Failure codes

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

## Privacy

- Work records live in `.lervo/state/knowledge/practice/`: Git-ignored, 0600 files in 0700 directories, A record without a practice is deleted at assessment. Evidence bundles stay on the observing host until their candidate is resolved, or for 7 days, as ADR-0543 "Evidence lasts until review" decides. Shapes keep only step kinds, executable identifiers, and digests. Tests cover the same permissions on macOS and Linux.
- Provider input is limited to repository paths inside the delegation's read roots, excludes paths the scanner classifies as private or secret, follows no symlink out of the repository, and is capped at 8 KiB per file and 32 KiB per candidate.
- Executable identifiers are normalized to a name without directories.
- Events carry identifiers, hashes, digests, and published skill paths only.

## Funnel measurement

The resident records daily counts and drop reasons at each step: observed, assessed with practice, drafted, accepted, materialized, published, exposed, used. A month with no skill then shows where the funnel stopped.
