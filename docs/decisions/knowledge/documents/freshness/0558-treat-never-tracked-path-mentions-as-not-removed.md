# ADR-0558: Treat never-tracked path mentions as not removed

Status: `accepted`
Decision date: 2026-11-02
Amends: [ADR-0463 document freshness](../0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) (reference resolution)
Related: [ADR-0464 document drift](../0464-report-document-drift-and-historical-documents.md), [ADR-0557 Tier 0 cross-check](0557-cross-check-freshness-candidates-in-an-independent-no-capability-session.md)
Contract: [Document freshness pipeline](../../../../specifications/knowledge/document-freshness/pipeline.md#detection-input), [candidates](../../../../specifications/knowledge/document-freshness/candidates.md)

## Context

ADR-0463 treats every reference that does not resolve in the current tree as stale evidence. The finding gets `reference_target_missing`, the evidence bundle lists the reference in `unresolvedReferences`, `no_change_needed` is refused, and the generator must replace the reference or append ` (removed)`.

That rule assumes an absent target was once present. Many documents mention paths that the repository never contained: fixture names in evidence notes, example paths, paths in other repositories, and planned files. On the Lervo repository two candidates appended ` (removed)` to evidence lines that cite fixture paths. Both edits were false, and the owner had to reject them. Nothing was removed, so there was nothing to record.

## Decision

A reference is **missing** only when it is unresolved and its target was tracked at some point. A path mention whose target no commit reachable from HEAD ever added is **never tracked**. It is not stale evidence.

- `DocumentFreshnessReference` gains `neverTracked: boolean`. It is true only for an unresolved `path_mention`. A Markdown link to a missing target is a broken link whatever its history, so a link is never `neverTracked`.
- Detection runs one bounded history lookup per observation for all unresolved path mentions: `git --literal-pathspecs log --full-history --no-renames --diff-filter=A --format= --name-only -z HEAD -- <targets>`, in chunks of 128 paths, with a 4 MiB output bound. Every file that ever existed was added by some commit. `--full-history` includes files that lived only on a merged side branch. A file under a directory target counts as that directory existing.
- Any doubt counts the target as tracked, which keeps the ADR-0463 behaviour: a Git failure or timeout, output over the bound, a shallow clone, or a target Git cannot take literally (absolute, `..`, `.`, empty segments, backslashes).
- One predicate, `freshnessReferenceMissing`, decides every gate: the `reference_target_missing` reason, priority-touched lines, the bundle's `unresolvedReferences`, the `missing_references_resolved` check, the README stale-path set, the deterministic assessment shortcut, and the independent assessment gate. They can no longer disagree.
- The `references_resolve` check exempts only the path mentions that the source finding already recorded as `neverTracked`. An edit cannot introduce a new absent path, because the exemption comes from the source finding, not from the output.
- The generation instruction says that a path the document mentions and `unresolvedReferences` does not list was never removed, so it must not be marked ` (removed)` or edited for being absent.
- The observation keeps only each document's hash, publication group, and references between its read pass and its finding pass, never the document bodies.

## Consequences

- Fixture, example, and external path mentions no longer create findings, forced edits, or owner rejections.
- Deleted and renamed paths behave exactly as before.
- A document that mentions a never-tracked path and also a removed path still gets a finding for the removed path only.
- Findings recorded before this change have no `neverTracked` field. The predicate reads a missing field as tracked, so stored findings and candidates keep their earlier meaning. The new field changes finding digests once, so the ADR-0461 fence observes every finding as changed one time.
- ADR-0464 lint still reports never-tracked mentions as unresolved. Lint describes the current tree; this decision changes only what freshness treats as stale evidence.

## Verification

`packages/repository-knowledge/test/document-freshness-reference-history.test.ts` covers removed, directory, side-branch, and never-tracked targets in a real repository. It also covers fail-safe answers for unsafe paths, a missing revision, a non-repository, and a shallow clone; the path-mention-only rule; the finding reason; the output check exemption without a new-path exemption; and an end-to-end observation where an entrypoint finding keeps only its removed reference.
