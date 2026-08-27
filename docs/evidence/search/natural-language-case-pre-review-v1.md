# Natural-language case pre-review v1

Status: `agent_pre_review`
Observation date: 2026-08-27

## Scope

This pre-review evaluates all 20 Korean-English retrieval pairs and 32 grounding cases for naturalistic framing, canonical-source grounding, task or category fit, distinct purpose, context sufficiency, authority, fail-closed behavior, and evidence-claim boundaries.

The machine-readable record, `benchmarks/reviews/natural-language-repository-v1.json`, is `verification_authored` and `pending_human_review`, with `humanApproval=false`. “Ready” means the agent found no defect, not that a person accepted the case as production-like ground truth.

## Complete review accounting

| Fixture family | Ready for human review | Needs specific attention | Total |
| --- | ---: | ---: | ---: |
| Korean-English retrieval pairs | 14 | 6 | 20 |
| Grounding cases | 29 | 3 | 32 |
| Combined | 43 | 9 | 52 |

Every fixture ID appears exactly once in the ready or attention partition. The repository validator binds the review to exact suite digests and rejects omitted, duplicated, unknown, or stale cases.

## Retrieval attention items

| Pair | Review reason |
| --- | --- |
| `nlpair_task_commit_convention` | English lexical and hybrid runs missed the expected source. |
| `nlpair_status_agent_workspace` | English lexical missed; hybrid recovered the source at rank 5. |
| `nlpair_boundary_user_owned_block` | Korean lexical and hybrid runs missed the expected source. |
| `nlpair_boundary_evidence_levels` | Both languages retrieved only one of two expected paths. |
| `nlpair_boundary_fuzzy_merge` | English lexical and hybrid runs missed both expected sources. |
| `nlpair_boundary_skill_use` | The English hybrid result regressed from rank 5 to rank 10. |

Reviewers must determine whether each prompt is representative and every expected path is essential. Candidate output is not grounds for changing expected paths.

## Grounding attention items

| Case | Review reason |
| --- | --- |
| `ngcase_rationale_terminal_runtime` | The rationale relies on instructions and repository state rather than a durable decision; a reviewer must confirm this evidence boundary. |
| `ngcase_shorthand_researcher_go` | A role is recognizable, but no task is supplied; `unknown` with clarification is a deliberate policy choice. |
| `ngcase_task_next_work` | Without a workstream but with a current repository, the fresh-clone route derives the next scope from the canonical roadmap; a reviewer must confirm this recovery boundary. |

The next-work expectation changed after review found that unconditional abstention contradicted the repository's fresh-clone continuation rule. The paired fail-closed case now uses `no_matching_source`: roadmap recovery is allowed only when canonical recovery input exists; otherwise, the request abstains. The other two items remain unresolved human policy choices.

## Replayed retrieval observation

The suites were replayed sequentially against the same 263-document, 961,704-byte corpus digest `sha256:04d7c7df0b257f3ca274a3825699d7c489658303143d669df850f027cba841f5`.

- Korean report `spreport_62cb94608ca8c018ff0c5ee6`: lexical 19/20; hybrid 19/20.
- English report `spreport_afb20dfe8cf1a02d007a19d4`: lexical 17/20; hybrid 18/20.

The checked-in candidate bundle records four observed lexical failures and one hybrid rank regression without copying query text, source paths, or source bodies from owner-only reports.

Three additional Korean historical-rationale discovery probes ask why structured workstream continuation exists. Operational `lexical-v1` returned no hits for all three. Their public text and query digests are bound to owner-only attempt IDs, but the probes are `verification_authored` and `pending_human_review`. They are discovery candidates, not accepted real-use failures, and do not change task-type coverage.

| Task type | Lexical failures observed | Coverage complete |
| --- | ---: | --- |
| Task start and how-to | 1 | yes |
| Historical rationale | 0 | no |
| Status, continuation, and impact | 1 | yes |
| Ambiguity and contract boundary | 2 | yes |

The bundle does not meet the roadmap requirement because its historical-rationale no-hit observations are unreviewed discovery probes rather than accepted real-use cases. It cannot be called a real-use or accepted failure bundle until a person reviews exact production-like cases. The recovered case does not offset the remaining failures, English rank regression, or failed task-type gates.

## Disposition

At observation time, keep `lexical-v1` operational and `local-hybrid-v1` inactive. ADR-0226 later retired the hybrid candidate. Next, complete explicit human review of all 52 exact cases, focusing on the nine attention items; accept, revise, or reject the three historical-rationale probes; and replay only the accepted bundle. Fuzzy merge remains later work.

See [ADR-0224](../../decisions/search/0224-natural-language-grounding-quality-evaluation.md), the [initial retrieval observation](korean-repository-retrieval-v1.md), and the [grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
