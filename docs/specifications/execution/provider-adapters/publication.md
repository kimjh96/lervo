# Publication Evaluation and Projection

## Evaluation and result projection

Managed runs use a role-bound English machine-result protocol. A separate read-only session of the selected local provider evaluates human-facing publication in an empty temporary repository without documents, tools, or write access. Its exact JSON is content-bound evidence. It is not independent cross-provider or human review, proof of understanding, or writing-policy E3. Failure blocks publication and CLI success, but not an already verified file change.

The validated result is the E4 source. Both adapters carry the same provider-neutral evidence-token instruction. The runtime does not post-filter matching tokens against task ground truth. Before publication, remove only exact evidence tokens for current E3 versions and store the human artifact under a separate digest. Writing checks, permits, `run.completed`, and display bind to that projection. `adapter.result.captured` retains the unprojected digest without content. Unknown tokens remain visible. An empty projection fails closed.

## Evidence roles and reference eligibility

Managed canary v12 showed that prompt-only citation minimization was not common-contract control: it reduced Codex recall while leaving Claude per-run precision failures, so the experiment was rolled back.

ADR-0293 adds required `task_evidence` and `governance_context` roles to provider-neutral envelope and receipt documents. ADR-0297 independently adds required `referenceEligible` state after v14 showed linked supporting task context was still over-citable.

Both adapters serialize role and eligibility identically. Only eligible task evidence has an exact E4 token; supporting task context and governance context have null tokens. A receipt changing either value is rejected, and a fabricated token for an ineligible document creates no E4 evidence. Raw provider output is not rewritten or compared with hidden evaluation identifiers.

V18 passed the unchanged Codex-Claude gates, and ADR-0301 activated this provider-neutral boundary without changing adapter behavior. ADR-0302 later retired ordinary linked selection after a lexical-only control found no quality uplift; the typed role and eligibility contract remains valid for direct context and the default-off exact canary.
