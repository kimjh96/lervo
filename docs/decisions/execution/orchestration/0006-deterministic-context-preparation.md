# ADR-0006: Deterministic context preparation

- Status: accepted
- Decision date: 2026-08-18

## Context

M0 separated selection (E1) from loading (E2), but no implementation selected and safely read repository documents. Multiple rules may select one document, specialist handoffs must compose with path rules, and neither a filename nor an unsafe symlink proves reading. Selection policy must remain separate from the event store, CAS, provider adapter, and execution lifecycle.

## Decision

### Package boundary

`@lervo/context` accepts the document registry, role, expected change paths, shared context, and handoffs. It returns an E0/E1 plan, loaded source bytes, E2 evidence, and snapshot-invalidity reasons.

Event append, CAS, adapter envelopes, and E3 remain outside the package. Selection accumulation, evidence/schema validation, filesystem loading, and freshness checks remain separate modules.

### Deterministic selection

- Normalize expected paths as repository-relative paths using `/`; reject absolute paths, `..`, and NUL.
- Select every `AGENTS.md` from the root through the nearest ancestor of each expected changed file; exclude sibling instructions.
- For an unregistered instruction document, derive a stable `doc_path_...` ID from a SHA-256 prefix of its normalized path. Prefer its registered ID when available.
- Match registry `connectedPaths` against expected paths with Node.js `path.matchesGlob`.
- Treat `repository.instructions` and `path.instructions` as built-in role rules. Resolve other required rules through a document-ID map.
- Read a document selected by multiple rules once, but retain one E1 receipt per reason.
- Discover readable shared context as E0. Automatically require only publications referenced by a valid handoff.
- Treat duplicate document paths, shared-context IDs, or handoff IDs; unresolved required rules; and conflicting expected hashes as contract errors.

### Safe E2 loading

E1 never contains the current content hash. Produce E2 only after reading all bytes and computing SHA-256 and byte count.

Validate the repository root and every path component with `lstat`; reject symlinks and non-file/non-directory entries. Open the final file with `O_NOFOLLOW`. Compare device, inode, size, mtime, and ctime before and after reading, then confirm that the path still resolves to the same inode and canonical path. A handoff document's bytes must match its publication hash.

Before E2, validate that the plan contains only current project/run/session E0/E1 evidence and that every document and reason belongs to it. Reject cross-run receipts and plans containing old E2/E3. This package owns integrity validation for the `LoadedContext` plan, documents, and E0–E2 evidence. Array order is non-semantic; match by ID.

Failure to load any document returns neither `LoadedContext` nor a partial E2 set. Loading never writes user files or changes timestamps.

### Snapshot invalidation

Immediately before use, revalidate loaded files and publications. Return distinct machine reasons for absent or unsafe paths; content changes; unpublished, expired, or replaced publications; revoked access; changed document IDs; and hash changes. Cross-project publications cannot affect replacement relations in this project.

Reasons contain no source body. The orchestrator records the document ID and reason in `context.invalidated`, closes write capability with `required_context_missing`, and prepares context again.

### Failures and privacy

| Category | Representative codes | Disposition |
| --- | --- | --- |
| Contract | `invalid_expected_path`, `invalid_path_rule`, `required_rule_unresolved`, `duplicate_document_path`, `duplicate_shared_context_id`, `duplicate_handoff_id`, `handoff_recipient_mismatch`, `handoff_invalid`, `invalid_context_evidence`, `invalid_context_plan`, `invalid_loaded_context` | Stop with `contract_validation_failed`; do not retry automatically. |
| Source loading | `document_missing`, `unsafe_document_path`, `document_read_failed`, `document_changed_during_read`, `content_hash_mismatch` | Close write capability with `required_context_missing`; repair or refresh the source and prepare again. |
| Coordinate conflict | `content_expectation_conflict`, `receipt_id_conflict`, `document_not_registered`, `shared_context_document_missing` | Stop with `contract_validation_failed`; never emit ambiguous evidence. |

Errors expose only managed relative paths and machine IDs, never document bytes, raw prompts, credentials, or provider payloads. This decision adds no event type or persistent state.

## Consequences

Selection and reading remain distinct in code and evidence. Root and nested instructions, path documents, role requirements, and specialist handoffs form one deterministic plan. General shared context is discoverable without claiming it was read. Stale E2 cannot survive source or publication changes. The next slice can accept only `LoadedContext` to build a provider-neutral envelope and validate E3.
