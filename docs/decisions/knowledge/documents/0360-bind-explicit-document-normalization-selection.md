# ADR-0360: Bind explicit document normalization selection

- Status: accepted
- Decision date: 2026-09-04

## Context

The `stale` scope prevented normalization from widening into unrecorded documents, but it still
selected every stale source as one workset. The reviewed renewal classifies those sources as five
reference repairs, 17 localized changes, and nine compound changes. One provider output also
targeted an existing sibling document, correctly blocking the combined plan and making unrelated
valid candidates unavailable for independent review.

## Decision

`knowledge normalize --provider <provider> --source <relative-markdown-path>` accepts repeatable
explicit source paths inside the chosen `stale` or `all-pending` lifecycle scope. Selection is a
repository-knowledge decision: every requested path must be a unique normalized relative Markdown
path and a current member of the selected scope. An empty, duplicate, malformed, current, or
out-of-scope selection fails before cache lookup or provider work with
`normalization_selection_invalid`.

An explicit workset carries `selection.kind=explicit_paths`. Its identity additionally binds the
ordered selected path, current content hash, and byte count tuples already used by the workset
digest. Exact paths and hashes remain only in local preflight and candidate output. Applied events
receive the selection kind, workset ID, scope, counts, and bytes but no source paths or document
bodies. Worksets without the selection field retain the complete-scope behavior and existing
candidate compatibility.

Candidate revalidation derives the explicit set from its content-bound items, proves every item is
still inside the lifecycle scope, and reconstructs the same workset identity. Unrelated pending
documents remain visible in repository counts but do not enter the selected candidate. Every
selected source still requires its own exact approval, and one candidate does not authorize a
sibling workset.

## Consequences

Reference, localized, compound, and later stale families can be preflighted, generated, reviewed,
rejected, or retried independently. Provider adapters receive the same envelopes and require no
selection-specific behavior. Existing-destination protection remains fail-closed; explicit
selection isolates such a failure but does not convert an existing user document into a writable
output.

The command remains path-oriented rather than embedding repository-specific family names. A
reviewed inventory or caller defines useful groups, while the core validates only lifecycle and
content boundaries.

## Verification

- Core tests prove explicit stale subsets, independent apply, remaining pending visibility, and
  fail-before-provider rejection of an out-of-scope path.
- CLI tests prove repeatable `--source` parsing and local preflight disclosure without adding paths
  to event coverage.
- Existing full-scope, cache, resource-ceiling, provider-adapter, and exact-approval tests remain
  unchanged.

## References

- [Bound document normalization worksets and preflight](0358-bound-document-normalization-worksets-and-preflight.md)
- [Observed document normalization resources](0359-observe-document-normalization-resources.md)
- [Document content normalization](../../../specs/document-content-normalization.md)
- [Document normalization evidence renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
