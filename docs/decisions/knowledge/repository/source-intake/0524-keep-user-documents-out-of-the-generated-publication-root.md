# ADR-0524: Keep user documents out of the generated publication root

Status: `accepted`
Decision date: 2026-10-20
Amends: [ADR-0303](../canonicalization/0303-branch-safe-knowledge-reconciliation-and-canonicalization.md) (the ignored publication root is reserved for generated pages)

## Context

ADR-0303 moved generated publications into an ignored publication root, `docs/knowledge/` by default. Every page there is a deterministic projection, and `lervo migrate knowledge` rebuilds it from canonical sources.

On 2026-09-05, commit `f03f38b1c` broke that assumption. Document normalization split the "Semantic knowledge" section out of `apps/cli/README.md` as `apps/cli/README/knowledge.md`. Layout migration then moved that user document to `docs/knowledge/repository/knowledge.md`, and the same commit removed the README section. The move lineage `klineage_6fb8a7f8559f114f829e2e52` records it.

The destination came from route arithmetic. Layout migration places an ordinary document at `<documentation root>/<route path>/<file>`. The documentation root is `docs`, and `knowledge/repository` is a decision route, so the result landed inside the publication root. The move guard rejected only exact previously generated paths, not new paths under the root.

Git ignores the publication root, so the moved guide left version control. No generator recorded it, so refreshes never replaced or deleted it. Lint reported nothing. For six weeks, one Mac checkout held the only copy. A rebuild or a fresh clone would have lost it.

The same gap affects entrypoints. A newly generated `AGENTS.md` told agents to read `docs/knowledge/index.md` without saying that the file exists only after a local `lervo migrate knowledge`. On GitHub, in a fresh clone, or for an agent without Lervo, the instruction points to a missing file.

## Decision

The publication root is reserved for pages that a recorded generation produced.

- Layout migration blocks a document destination inside the publication root with `destination_in_publication_root`. The plan fails closed, as it does for other unsafe destinations, until the route or the publication root changes.
- `lervo knowledge structure move`, `split`, and `merge` reject destinations inside the publication root.
- Lint warns with `publication_root_unmanaged_file` for every file under the publication root that no recorded generation produced. Such a file is outside Git and outside every generator's replacement rule.
- The generated `AGENTS.md` names the configured index path, says that Git ignores it, says how to build it, and points agents without Lervo to the tracked documentation.

The publication root stays ignored. Generated pages embed source-snapshot identifiers and counts that change with every source change, so tracking them would reintroduce the merge conflicts ADR-0303 removed.

The stranded guide is restored at its pre-move path, `apps/cli/README/knowledge.md`, with the exact bytes recorded by the move lineage.

## Consequences

User content can no longer enter the publication root through a Lervo operation. A direct write by a person or tool still can; lint reports it.

A repository whose taxonomy routes collide with its publication root now sees a blocked layout plan instead of a silent loss. Resolve it by refining the route or moving the publication root.

Repositories whose `AGENTS.md` is still an unedited Lervo generation receive the corrected entrypoint on their next knowledge refresh. User-edited entrypoints keep their bytes.

## Verification

- Move and split tests reject destinations under the publication root and leave source bytes unchanged.
- A layout migration test blocks an explicitly routed document whose destination falls under the configured publication root.
- Lint tests warn about an unrecorded file under the publication root and stay silent when the root is absent.
- In this repository, the new lint check reports exactly `docs/knowledge/repository/knowledge.md` among 80 files, against 1,775 recorded generation outputs.
