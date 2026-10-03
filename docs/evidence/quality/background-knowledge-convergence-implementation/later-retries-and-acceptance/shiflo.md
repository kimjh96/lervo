# Shiflo corrections and scoped approvals

## PR/workflow source corrections

Renewed lifecycle event 9904 retained historical PR/Code Quality/EAS `knowledge_semantic_review_rejected`. Exact PR/EAS canonical documents were corrected against Bora review/current workflows without workflow behavior changes or fresh approval claims. Mac/WSL hashes matched:

- `035c4fc24c4b4829601e754ea9b437aff659f8bf24470386e5fae3a869c54d97`
- `bfd379761eeb7063db6c2ed5c6471df64726c6f7ff6080cf1a10ed555dbe6f10`

Lint was valid. Convention tests initially failed because WSL had `bun` but no `bunx`; a temporary link to Bun 1.3.3 yielded 48/48 passes. New source triggered review; lifecycle currency/Bora publication remained unverified.

The WSL local tool directory then restored `bunx` as a link to installed Bun 1.3.3; `bunx --version` returned `1.3.3`. Shiflo workstream revision 369 and Lervo Mac revision 141 recorded remaining gates. At 04:19 UTC, corrected Shiflo sources continued review/integration while Lervo had passed review and entered apply verification. Neither had a new lifecycle completion receipt.

## Notification-health correction and review

At 04:39 UTC, lifecycle event 10008 rejected a later family: `.agents/skills/notification-health/SKILL.md` and manifest. Private review found omitted activation conditions and exact Korean labels/headings, plus an assessment quoting a skill-SQL reference instead of canonical Q1–Q5 descriptions.

Canonical reporting now includes activation scope, exact Q0–Q5 read-only SQL, and fixed Korean template headings/column order. Mac/WSL hash: `eda53b79c9e647c7e5c9001402db9ed328ce060f48a41691155f287ae147a3ec`. Lint returned `valid: true`; conventions passed 48/48 using restored `bunx`. Source detection queued review. The edit alone established neither approval nor currency; Lervo apply was still verifying.

Review 10055 approved corrected notification-health coverage, explicitly citing Q0–Q5, Korean report structure, privacy, and empty-result handling. Integration became current at 10057, then assessment resumed. This scoped approval did not supersede the older lifecycle rejection or prove currency. Workstream revision 370 recorded these limits and the instruction to skip GitHub billing remediation.

## Notification-health apply and remaining lifecycle rejection

Shiflo applied the final pending notification-health normalization at 10113 under `knormplan_35766cc1a35c0cff5e07391d`. Independent review and two bound verification receipts passed. The apply revised the parent, created `presentation.md`/`queries.md` under its first artifact directory, replaced the exact normalization record, and reduced counted normalization debt to zero.

Lifecycle advanced at 10119, then 10121 retained separate PR/Code Quality/EAS `knowledge_semantic_review_rejected`.

Private proof cited omitted PR examples and verification/Notes details, an unqualified local-hook claim, and EAS caller/policy assertions without linked context. All three canonical documents were corrected against exact supplied sources:

- PR details were made explicit.
- The hook claim was attributed to a workflow comment.
- EAS retained only source-supported caller/manual-retry descriptions and stated required inputs/`ubuntu-latest`.

Fresh approval/lifecycle were still required after these corrections.

## Final scoped approvals and acceptance boundaries

Current exact hashes were assessed at 10188. Independent review 10209 approved all three covered dispositions; integration reached current at 10211. Review explicitly distinguished EAS source comments from independently verified caller/retry behavior.

WSL lint returned `valid: true` with stale materialization/source-unit warnings while work continued; conventions passed 48/48. Mac/WSL hashes matched all three corrected documents and the notification-health parent/two children. This scoped approval does not prove full currency or publish Bora's pending workforce result.

At the owner's request, GitHub billing remediation and further CI reruns were skipped after GitHub rejected a Shiflo workflow before runner start; no CI pass is inferred. The owner also clarified that no deployment was requested in this turn and requested skipping public search registration and GitHub billing remediation. These external actions are not part of completion.
