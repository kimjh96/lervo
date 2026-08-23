# ADR-0001: M0 Contracts and Data Defaults

Status: `accepted`
Decision date: 2026-08-18

## Context

Lervo's first implementation must establish the project, event, context-evidence, and adapter boundaries before implementing providers. If type and runtime-validation specifications are maintained separately, Codex and Claude may implement different semantics or populate states that telemetry cannot prove. Human-facing writing can also regress into translated phrasing, noun fragments, and disconnected paragraphs if left to each provider's default voice. M0 therefore includes a provider-neutral writing contract informed by the existing Actverse writing rules and pre-publication guard experience. Privacy and local-retention defaults must also be decided before implementing the event store.

## Decision

### Contract sources

- Maintain JSON Schema Draft 2020-12 objects as TypeScript constants in `@lervo/schemas`.
- Infer TypeScript types from those same objects with `json-schema-to-ts`.
- External storage formats use schema version `1`, RFC 3339 timestamps, and `sha256:<64 hex>` content hashes.
- Project, run, session, event, document, and receipt IDs are prefixed opaque IDs; the internal generation algorithm is not fixed as part of the public contract.

### Context evidence and the write gate

- `discovered(E0)`, `selected(E1)`, `loaded(E2)`, `injected(E3)`, and `referenced(E4)` are discriminated receipts with distinct fields, not one mutable state.
- The write gate opens only when an E1→E2→E3 chain exists for the same project, run, and session.
- The E2 and E3 content hashes must match the current hashes of all required documents.
- E3 must match the current context generation and set `controlledInput: true`.
- E3 does not mean understanding or compliance. Only an explicit output reference is recorded as E4.

### Adapter contract

- Every provider adapter implements the descriptor, start request/session, context envelope/receipt, normalized event, and stop request/result contracts.
- Capabilities are explicitly `supported`, `unsupported`, or `unknown`; unobserved values are never inferred.
- A context receipt is valid only when it reproduces the delivered envelope's coordinates, generation, document hashes, and scope.
- Start, session, context envelope, and receipt retain the same role and writing-policy ID. When a writing policy exists, the policy source document ID and hash appear in both envelope and receipt.
- The v0 context envelope permits `inline`, which delivers content directly in memory, and `cas`, a lossless local CAS reference.

### Role contract

- A role is not a persona. It is a contract for request type, input schema, context policy, capabilities, artifacts, verification, and handoff.
- File read/write, shell execution, network, external messaging, deployment, and data-mutation capabilities are each declared as `allow`, `deny`, or `require_approval`. An omission is a contract error.
- A mutating role requires at least E3 context assurance, and its handoff requires an evidence link.
- Artifact locations must be repository-relative paths.
- Artifacts for human or mixed audiences require a locale and writing-policy ID. Machine-only artifacts do not use a writing policy.

### Human-facing writing contract

- A policy is not fixed prose. It defines applicable surfaces, audience, information order, sentences and paragraphs, terminology, action phrasing, and evidence and verification requirements. The role's artifact kind selects the policy.
- The original default Korean policy leads with purpose or conclusion, uses complete sentences and cohesive paragraphs, avoids translated phrasing and noun-fragment lists, and explains internal terms on first use.
- Machine identifiers retain their exact form but remain distinct from human-facing titles, statuses, and descriptions. Writing names the subject and action directly instead of assigning confirmation or judgment to an abstract actor.
- Deterministic checks detect only clearly prohibited forms. Passing a regular expression is not evidence of natural language quality.
- A model or person, separate from generation, evaluates naturalness, paragraph context, audience-appropriate expression, and concrete results and actions.
- A required semantic check that did not run is not a pass. The publication gate opens only when every check passes and the policy, artifact, content hash, and locale all match.

### Skill contract

- A skill records source/publisher, version/content hash, supported roles, provider/runtime/platform/tool compatibility, required capabilities, input/output schemas, trust, and enabled scope.
- Provider compatibility is `any` or an allowlist; compatibility that cannot be confirmed is not treated as supported.
- `reviewed` requires a reviewer and review timestamp. `verified` additionally requires a valid signature.
- A manifest contains schema references and digestible metadata, not sensitive real inputs.

### Document registry contract

- The registry uses document ID as its key and structurally prevents duplicate IDs.
- An `observed` document must have `user` ownership and is never modified automatically by Lervo.
- A `canonical` document permits `user` or `managed_blocks`; a `generated` document permits only `managed_blocks` or `lervo_generated`.
- `managed_blocks` preserves content outside its blocks and records the IDs and hashes of generation inputs.
- `lervo_generated` is a dedicated file with no user content and records its generation manifest and input hashes.
- Exact managed-block marker syntax and parser selection remain a separate ADR before M4.

### Privacy and retention defaults

| Item | Default |
|---|---|
| Local event-metadata retention | 90 days |
| Local source-artifact retention | 30 days |
| Store raw prompts in events | Disabled |
| Store document bodies in events | Disabled |
| Hub synchronization | Disabled |
| Event payload processing | Per-event-type allowlist followed by sensitive-key removal |

A project policy may explicitly change retention periods. Source content present in a context envelope during execution is distinct from source content retained in an append-only event payload. Writing evaluation stores artifact/content hashes, check status, violation counts, and evidence digests instead of source content. If redaction or telemetry recording fails, execution does not continue while omitting the event; mutating capabilities close.

A role's sensitive-input marker is redaction-requirement metadata, not an actual value. Skill source URIs and publisher/reviewer IDs, document responsible parties, and relative paths are local registry metadata and are excluded from Hub synchronization and event payloads by default.

### Failure disposition

| Code | Local run | Mutating capability | Retry |
|---|---|---|---|
| `telemetry_recording_failed` | Stop | Deny | Allowed |
| `redaction_failed` | Stop | Deny | Allowed |
| `hub_sync_failed` | Continue | Allow | Allowed |
| `derived_index_failed` | Continue through an explicit path | Allow | Allowed |
| `required_context_missing` | Stop before context preparation | Deny | Allowed |
| `provider_capability_unsupported` | Stop unless policy permits lower assurance | Deny | Not allowed |
| `capability_denied` | May continue read-only | Deny | Not allowed |
| `approval_required` | Wait for approval | Deny | Allowed after approval |
| `contract_validation_failed` | Stop before start | Deny | No automatic retry |
| `writing_verification_failed` | Keep local changes and stop before publication | Allow | Allowed after correction |
| `artifact_storage_failed` | Stop when required artifact storage or verification fails | Deny | Allowed |

## Consequences

- Schema fixtures and the adapter contract suite detect contract drift before provider implementations do.
- Hub or derived-index failures do not block local source execution.
- Telemetry or redaction failures do not degrade into evidence-free mutation.
- Roles, skills, the document registry, and writing policies and evaluations all share the same schema/type/fixture verification boundary, completing the M0 contract.
- Provider changes retain the same writing policy and publication gate, while policy injection and compliance evaluation remain separate evidence.
