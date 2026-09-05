# Context evidence

| Level | Meaning |
| --- | --- |
| E0 | Candidate discovered. |
| E1 | Candidate selected by policy. |
| E2 | Current bytes loaded and validated. |
| E3 | Adapter acknowledged the exact delivered envelope. |
| E4 | Validated provider result explicitly cited the exact injected version. |

Each envelope and receipt has one provider-neutral `documentRole`, either `task_evidence` or `governance_context`, and a required `referenceEligible` state. Instructions, workstreams, writing policies, and protocols are governance; substantive task sources are task evidence. Governance wins when a document has both roles and is never reference eligible.

Direct task selection is eligible. In the default-off exact canary, task evidence selected only as managed linked support is ineligible; direct provenance wins when both occur. Missing, unknown, changed, or role-inconsistent values fail delivery before E3 acceptance.

E3 proves controlled injection, not understanding or use. E4 requires a structured result matching E3 coordinates, document version, role, and eligibility. Only eligible task evidence receives the exact standalone `lervo-e4:<documentId>:<contentHash>` token; supporting task context and governance context receive null. The runtime neither rewrites output nor compares it with hidden evaluation identifiers. E4 proves bounded output citation, not attention, reliance, understanding, correctness, or internal use.

## Coverage and summaries

`@lervo/context-coverage` rebuilds one report from canonical events, retaining every E1 reason, E2 version and revision, enhanced E3 coordinate, valid E4, highest evidence, and missing stage. Delivery, reference, relevance, and selection ratios remain separate. Unknown denominators are `null` with a reason; no combined score exists.

A managed-run search summary may project only the count and sorted unique document IDs from canonical E4 evidence as `referencedDocuments` and `referencedDocumentIds`. It excludes bodies, paths, prompts, provider output, credentials, and expected evaluation identifiers. Evidence events remain canonical.

Unmanaged observations use `prepared -> referenced`, never E1–E4. Preparation proves only hook-side construction; reference proves only a matching marker in bounded Stop output. Lervo neither rewrites nor stores that output.
