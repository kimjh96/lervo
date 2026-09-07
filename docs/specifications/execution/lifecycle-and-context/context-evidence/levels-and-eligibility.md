# Evidence levels and eligibility

| Level | Meaning |
| --- | --- |
| E0 | Candidate discovered. |
| E1 | Candidate selected by policy. |
| E2 | Current bytes loaded and validated. |
| E3 | Adapter acknowledged the exact delivered envelope. |
| E4 | Validated provider result explicitly cited the exact injected version. |

Each envelope and receipt has one provider-neutral `documentRole`: `task_evidence` or `governance_context`, plus a required `referenceEligible` state. Instructions, workstreams, writing policies, and protocols are governance; substantive task sources are task evidence. Governance wins when a document has both roles and is never reference eligible.

Direct task selection is eligible. In the default-off exact canary, task evidence selected only as managed linked support is ineligible; direct provenance wins when both occur. Missing, unknown, changed, or role-inconsistent values fail delivery before E3 acceptance.

E3 proves controlled injection, not understanding or use. E4 requires a structured result matching E3 coordinates, document version, role, and eligibility. Only eligible task evidence receives the exact standalone `lervo-e4:<documentId>:<contentHash>` token; supporting task context and governance context receive null.

The runtime neither rewrites output nor compares it with hidden evaluation identifiers. E4 proves bounded output citation, not attention, reliance, understanding, correctness, or internal use.
