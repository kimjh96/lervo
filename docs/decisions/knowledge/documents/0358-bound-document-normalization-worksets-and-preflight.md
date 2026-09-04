# ADR-0358: Bind document normalization worksets and preflight

- Status: accepted
- Decision date: 2026-09-04

## Context

Document normalization selected every eligible source without current lifecycle evidence. Renewing 31 reviewed stale document families would therefore also select 57 newly introduced documents. Before provider generation, the command exposed neither the exact compiler-bound cache disposition nor a resource bound. Partial candidates reported only selected-item coverage, which could not distinguish complete workset coverage from repository-wide currency.

## Decision

Repository knowledge defines two content-bound normalization scopes: `all_pending` and `stale`, exposed by the CLI as `all-pending` and `stale`. `stale` includes only eligible pending source paths with a structurally valid prior normalization record whose output or resource binding is no longer current. Invalid records and sources without prior records remain pending and are not reclassified as stale.

Each new candidate binds a `knormset_*` workset identity to the repository snapshot, scope, repository lifecycle counts, and ordered tuples of selected path, content hash, and byte count. `complete: true` means the declared scope was selected completely, not that all repository normalization is current. Candidate planning re-derives that scope. Applying a stale workset renews only its selected lifecycle records; unrecorded pending documents remain visible.

`knowledge normalize --provider <provider> --preflight` is read-only. It may probe the configured provider executable to derive the exact compiler descriptor, but never invokes the compiler normalization operation, stores a candidate, changes repository documents, or emits an applied event. Its report includes exact selected paths and content hashes, bytes, envelope count, schema-valid per-document cache hits and misses, compiler coordinates, repository counts, and resource ceilings.

Default preflight ceilings are 1 MiB of selected source and 256 provider calls. CLI callers may set either ceiling lower or higher using positive safe integers. Provider-call capacity conservatively includes the initial envelope call and every possible single-document retry. A blocked preflight prevents the first normalization call; a runtime counter prevents subsequent calls from exceeding the same ceiling.

Reports and candidates remain ignored local state. Events do not contain exact paths or hashes. `knowledge.materialization.applied` keeps its existing name and records bounded workset scope, identity, counts, and bytes in `coverage`, distinguishing partial renewal without including document bodies. The new `normalization_budget_exceeded` failure indicates that a declared byte or call ceiling prevented generation. Cache corruption is a miss, not evidence.

## Consequences

Operators can inspect and budget a stale renewal before incurring provider cost, and provider generation cannot expand from that workset to unrelated new documents. Cache reuse is attributed to the exact compiler build and source content. Token and elapsed-time observation require a separate compiler-boundary change; missing measurements are not represented as zero.

New ignored candidates are intentionally incompatible with older candidate bytes lacking a workset binding. Canonical documents and normalization lifecycle records remain unchanged, so deleting the local candidate remains the supported recovery.

## Verification

- Core tests cover stale-versus-unrecorded selection, exact cache reporting, partial-apply semantics, and fail-before-provider byte and worst-case call ceilings.
- CLI tests prove that JSON preflight performs no normalization invocation and that ordinary candidate and apply behavior remains available.
- Type, quality, document lifecycle, knowledge migration and lint, packed-CLI, and exact-base release-completion checks cover integration.

## References

- [Document content normalization](../../../specs/document-content-normalization.md)
- [Reviewed document content normalization](../repository/0195-reviewed-document-content-normalization.md)
- [Document normalization evidence renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
