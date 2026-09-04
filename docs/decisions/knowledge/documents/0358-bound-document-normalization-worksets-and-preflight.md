# ADR-0358: Bind document normalization worksets and preflight

- Status: accepted
- Decision date: 2026-09-04

## Context

Document normalization selected every eligible source without current lifecycle evidence. A
reviewed renewal of 31 stale document families would therefore also select 57 newly introduced
documents. The command exposed neither the exact compiler-bound cache disposition nor a resource
bound before provider generation. A partial candidate also carried only selected-item coverage,
which was insufficient to distinguish complete workset coverage from repository-wide currency.

## Decision

Repository knowledge owns two content-bound normalization scopes: `all_pending` and `stale`. The
CLI spells them `all-pending` and `stale`. `stale` contains only eligible pending source paths with
a structurally valid prior normalization record whose output or resource binding is no longer
current. Invalid records and sources with no prior record remain pending but are not silently
reclassified as stale.

Every new candidate binds a `knormset_*` workset identity to the repository snapshot, scope,
repository lifecycle counts, and the ordered selected path, content-hash, and byte-count tuples.
`complete: true` means the declared scope was selected completely; it never means all repository
normalization is current. Candidate planning re-derives the same scope. Applying a stale workset
renews only its selected lifecycle records, while unrecorded pending documents remain visible.

`knowledge normalize --provider <provider> --preflight` is read-only. It may probe the configured
provider executable to derive the exact compiler descriptor, but it never calls the compiler's
normalization operation, stores a candidate, changes repository documents, or emits an applied
event. The report includes exact selected paths and content hashes, bytes, envelope count,
schema-valid per-document cache hits and misses, compiler coordinates, repository counts, and
resource ceilings.

The default preflight ceilings are 1 MiB of selected source and 256 provider calls. CLI callers may
lower or raise either with positive safe integers. Provider-call capacity conservatively includes
the initial envelope call and every possible single-document retry. A blocked preflight prevents
the first normalization call, and a runtime counter prevents later calls from exceeding the same
ceiling.

The report and candidate remain ignored local state. Exact paths and hashes are not copied into
events. `knowledge.materialization.applied` retains its existing event name and includes bounded
workset scope, identity, counts, and bytes inside `coverage`; this distinguishes partial renewal
without adding document bodies. The new `normalization_budget_exceeded` failure means a declared
byte or call ceiling prevented generation. Cache corruption remains a miss rather than evidence.

## Consequences

Operators can inspect and budget the intended stale renewal before provider cost, and provider
generation cannot widen from that workset to unrelated new documents. Cache reuse is attributed
to the exact compiler build and source content. Token and elapsed-time observation remain a
separate compiler-boundary change; absence of those measurements is not represented as zero.

New ignored candidates are intentionally incompatible with older candidate bytes that lack a
workset binding. Canonical documents and normalization lifecycle records are unchanged, so local
candidate deletion remains the supported recovery.

## Verification

- Core tests prove stale-versus-unrecorded selection, exact cache reporting, partial apply
  semantics, and fail-before-provider byte and worst-case call ceilings.
- CLI tests prove JSON preflight performs no normalization invocation and ordinary candidate/apply
  behavior remains available.
- Type, quality, document lifecycle, knowledge migration and lint, packed-CLI, and exact-base
  release-completion checks cover integration.

## References

- [Document content normalization](../../../specs/document-content-normalization.md)
- [Reviewed document content normalization](../repository/0195-reviewed-document-content-normalization.md)
- [Document normalization evidence renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
