# ADR-0001: M0 Contracts and Data Defaults

- Status: accepted
- Decision date: 2026-08-18

## Context

Lervo's first implementation must establish project, event, context-evidence, and adapter boundaries before adding providers. Separate type and runtime-validation specifications could let Codex and Claude implement different semantics or populate states unsupported by telemetry.

Human-facing writing also needs a provider-neutral contract, informed by existing Actverse writing rules and pre-publication guard experience, to prevent translated phrasing, noun fragments, and disconnected paragraphs. Privacy and local-retention defaults must precede the event store.

## Decision

### Contract sources

- Maintain JSON Schema Draft 2020-12 objects as TypeScript constants in `@lervo/schemas`.
- Infer TypeScript types from those objects with `json-schema-to-ts`.
- External storage formats use schema version `1`, RFC 3339 timestamps, and `sha256:<64 hex>` content hashes.
- Project, run, session, event, document, and receipt IDs are prefixed opaque IDs. Their internal generation algorithm is not part of the public contract.

### Context evidence and the write gate

- `discovered(E0)`, `selected(E1)`, `loaded(E2)`, `injected(E3)`, and `referenced(E4)` are distinct discriminated receipts, not one mutable state.
- The write gate opens only for an E1→E2→E3 chain belonging to the same project, run, and session.
- E2 and E3 content hashes must match the current hashes of all required documents.
- E3 must match the current context generation and set `controlledInput: true`.
- E3 proves neither understanding nor compliance. Only an explicit output reference is recorded as E4.

### Adapter contract

- Each provider adapter implements descriptor, start request and session, context envelope and receipt, normalized event, and stop request and result contracts.
- Capabilities are explicitly `supported`, `unsupported`, or `unknown`; unobserved values are not inferred.
- A context receipt is valid only when it reproduces the delivered envelope's coordinates, generation, document hashes, and scope.
- Start, session, context envelope, and receipt retain the same role and writing-policy ID. If a writing policy exists, its source document ID and hash appear in both the envelope and receipt.
- The v0 context envelope supports `inline` content delivered directly in memory and `cas` as a lossless local CAS reference.

### Role contract

- A role is a contract for request type, input schema, context policy, capabilities, artifacts, verification, and handoff—not a persona.
- File read and write, shell execution, network, external messaging, deployment, and data mutation are each declared `allow`, `deny`, or `require_approval`. Omission is a contract error.
- A mutating role requires at least E3 context assurance, and its handoff requires an evidence link.
- Artifact locations are repository-relative paths.
- Human or mixed-audience artifacts require a locale and writing-policy ID. Machine-only artifacts use no writing policy.

### Human-facing writing contract

A policy defines applicable surfaces, audience, information order, sentence and paragraph requirements, terminology, action phrasing, and evidence and verification requirements. It does not prescribe fixed prose. The role's artifact kind selects the policy.

The original default Korean policy leads with purpose or conclusion, uses complete sentences and cohesive paragraphs, avoids translated phrasing and noun-fragment lists, and explains internal terms when first used.

Machine identifiers retain their exact form but remain distinct from human-facing titles, statuses, and descriptions. Writing names subjects and actions directly rather than assigning confirmation or judgment to an abstract actor.

Deterministic checks detect only clearly prohibited forms; matching a regular expression does not prove natural-language quality. A model or person separate from generation evaluates naturalness, paragraph context, audience-appropriate expression, and concrete results and actions.

A required semantic check that does not run is not a pass. The publication gate opens only when every check passes and the policy, artifact, content hash, and locale all match.

### Skill contract

- A skill records its source and publisher, version and content hash, supported roles, provider, runtime, platform, and tool compatibility, required capabilities, input and output schemas, trust, and enabled scope.
- Provider compatibility is `any` or an allowlist. Compatibility that cannot be confirmed is not supported.
- `reviewed` requires a reviewer and review timestamp. `verified` also requires a valid signature.
- A manifest contains schema references and digestible metadata, not sensitive real inputs.

### Document registry contract

- The registry is keyed by document ID and structurally prevents duplicate IDs.
- An `observed` document has `user` ownership and Lervo never modifies it automatically.
- A `canonical` document permits `user` or `managed_blocks`; a `generated` document permits only `managed_blocks` or `lervo_generated`.
- `managed_blocks` preserves content outside managed blocks and records generation-input IDs and hashes.
- `lervo_generated` is a dedicated file without user content and records its generation manifest and input hashes.
- Exact managed-block marker syntax and parser selection require a separate ADR before M4.

### Privacy and retention defaults

| Item | Default |
|---|---|
| Local event-metadata retention | 90 days |
| Local source-artifact retention | 30 days |
| Store raw prompts in events | Disabled |
| Store document bodies in events | Disabled |
| Hub synchronization | Disabled |
| Event payload processing | Per-event-type allowlist followed by sensitive-key removal |

Project policy may explicitly change retention periods. Source content present in an execution context envelope is distinct from source content retained in an append-only event payload.

Writing evaluation stores artifact and content hashes, check status, violation counts, and evidence digests instead of source content. If redaction or telemetry recording fails, execution cannot continue while omitting the event; mutating capabilities close.

A role's sensitive-input marker is redaction-requirement metadata, not a value. Skill source URIs and publisher or reviewer IDs, document responsible parties, and relative paths are local registry metadata excluded from Hub synchronization and event payloads by default.

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

Schema fixtures and the adapter contract suite detect contract drift before provider implementations. Hub and derived-index failures do not block local source execution, while telemetry and redaction failures cannot degrade into evidence-free mutation.

Roles, skills, the document registry, writing policies, and evaluations share one schema, type, and fixture verification boundary, completing the M0 contract. Provider changes retain the writing policy and publication gate, while policy injection and compliance evaluation remain separate evidence.
