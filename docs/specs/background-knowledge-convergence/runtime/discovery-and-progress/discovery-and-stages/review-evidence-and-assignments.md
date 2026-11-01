# Review evidence and assignments

## Retrieval and assessment

Canonical review retrieves context using bounded terms from actual source paths. Existing Markdown sources also supply headings, cited document paths, and explicit `never` clauses. Planned generated documents that do not yet exist supply only path terms. Source reads used only for query enrichment and link discovery are optional. Capturing complete canonical source bytes still fails closed.

Retrieval preserves the knowledge ranker's order and uses a generic repository-knowledge query only when no source supplies a term. This lets pull-request templates retrieve release and publication contracts without filling the review window with unrelated knowledge-lifecycle documents. The existing 20-document context window, eight linked documents, exact content hashes, source fence, and independent semantic review still apply. Retrieval supplies evidence; it neither establishes coverage nor approves drafts.

Canonical assessment sends at most four contiguous sources per provider call. It retains every applicable instruction, then fills remaining places in a 28-document target with the highest-ranked canonical candidates. Independent review receives the exact captured documents supplied to assessment. Candidates omitted from assessment cannot be cited as covered. Provider deadlines and reviewed delegation ceilings do not increase. A timed-out provider JSON runner retains its process status so the bounded transient-retry path can distinguish timeout from invalid semantic output.

## Assignments and application

Distinct agents generate, review, write, and integrate under durable provenance-bound assignments. Canonical drafts use a managed detached workspace, verification seal, exact integration ref transition, and exact repository materialization.

Before applying an accepted subset, normalization compares exact sources, review units, semantic checks, candidate bytes, and independently approved output hashes. Rejected families retain exact rejection evidence, do not repeatedly regenerate unchanged output, and do not block another authorized family.

Applicable instruction documents remain required and fail closed. Optional canonical candidates and focused hits skip missing, oversized, unsafe, changed-during-read, or non-UTF-8 documents. Internal and external symlinks are not followed. Query enrichment uses the same optional reader, bounded to 64 attempts per selection. A readable recommendation with a stale hash still fails closed. Only loaded documents form context bindings; private `contextSkips` entries record each skipped path and closed reason separately from loading measurements.

Assessment also receives tracked document routes, roles, capacity overrides, and observed directory counts. New drafts must use a compatible child folder with capacity within delegated roots. The independent reviewer receives the same guidance. [ADR-0532](../../../../../decisions/knowledge/maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md) defines parking and private failure-path evidence.
