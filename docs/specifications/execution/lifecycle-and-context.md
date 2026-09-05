# Managed Lifecycle and Context Evidence

## Managed run lifecycle

Typed semantic grounding precedes selection and effects; related specifications are linked from the [execution specification](../execution.md).

```text
causal work admitted -> requested -> resolved -> documents/capabilities recommended and selected
-> bytes loaded -> context prepared -> provider started
-> context injected -> capabilities activated / skills invoked -> provider turn
-> provider result observed -> repository verified -> completed
```

Completion requires agreement among contracts, capability decisions, context evidence, provider results, repository snapshots, and verification. Other provider work is `unmanaged`.

### Direct hooks

Direct Codex/Claude hooks use a self-verifying repository-local contract-v2 runtime with exact-hash loads up to 28 KiB. Preparation applies provider-neutral projection and qualified Lexical v2 only to registered repository knowledge. It records `unmanaged_terminal_retrieval_only` without semantic-action coordinates, effect, workflow, authority, external route, or durable rule. Empty or failed retrieval proves nothing else; internal failure returns empty success without evidence. Managed execution stays typed and fail-closed.

The lifecycle cache binds CLI version, repository revision, supplemental-source and generated-projection digests; any change invalidates it.

Preparation creates no managed run and proves no acceptance, understanding, or use. Direct root `Stop` records bounded lifecycle and reference observations when possible. Non-current state records `action_required` with completion `allowed`; unmatched or failed audits return empty success without evidence. Agents still update workstreams and declarations after changes. Attached workers retain fail-closed isolation. Reference tokens are standalone Markdown HTML comments; legacy v1 tokens remain valid in flight.

A current workstream must match its latest event and CAS artifact. Managed runs load exact bytes before E3. Direct hooks prepend at most 8 KiB and record bounded identity, revision, hash, byte, and scope coordinates. Missing or stale direct state is a finding, not permission or completion evidence.

### Cross-provider continuation

Continuation preserves the verified workstream identity, not a provider conversation. Installed acceptance must:

- Use distinct run, Lervo session, provider, and provider-session coordinates.
- Load and inject the exact current workstream revision.
- Bind both completed runs to that workstream and their verified result digests.

A changed current projection must fail before provider creation. No continuation evidence implies native provider-session resume, conversation-memory transfer, or semantic provider reliance.

### Managed document selection

Managed sessions suppress native project hooks. Graph-selected registered documents use bounded post-search projections and ordinary E1–E3 evidence (ADR-0216, ADR-0217). Ordinary runs do not select linked-only sources after search. The managed linked-evidence specification owns the default-off exact canary and its historical, boundary, acceptance, and retirement requirements.

## Context evidence

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

### Coverage and summaries

`@lervo/context-coverage` rebuilds one report from canonical events, retaining every E1 reason, E2 version and revision, enhanced E3 coordinate, valid E4, highest evidence, and missing stage. Delivery, reference, relevance, and selection ratios remain separate. Unknown denominators are `null` with a reason; no combined score exists.

A managed-run search summary may project only the count and sorted unique document IDs from canonical E4 evidence as `referencedDocuments` and `referencedDocumentIds`. It excludes bodies, paths, prompts, provider output, credentials, and expected evaluation identifiers; evidence events remain canonical.

Unmanaged observations use `prepared -> referenced`, never E1–E4. Preparation proves only hook-side construction; reference proves only a matching marker in bounded Stop output. Lervo neither rewrites nor stores that output.
