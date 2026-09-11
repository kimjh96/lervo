# Evidence Roles and Reference Eligibility

Managed canary v12 showed prompt-only citation minimization was not common-contract control: it reduced Codex recall while leaving Claude per-run precision failures. The experiment was rolled back.

ADR-0293 adds required `task_evidence` and `governance_context` roles to provider-neutral envelope and receipt documents. ADR-0297 independently adds required `referenceEligible` state after v14 showed linked supporting task context was still over-citable.

Both adapters serialize role and eligibility identically. Only eligible task evidence has an exact E4 token; supporting task context and governance context have null tokens. A receipt changing either value is rejected. A fabricated token for an ineligible document creates no E4 evidence. Raw provider output is not rewritten or compared with hidden evaluation identifiers.

V18 passed the unchanged Codex-Claude gates. ADR-0301 activated this provider-neutral boundary without changing adapter behavior. ADR-0302 later retired ordinary linked selection after a lexical-only control found no quality uplift. The typed role and eligibility contract remains valid for direct context and the default-off exact canary.
