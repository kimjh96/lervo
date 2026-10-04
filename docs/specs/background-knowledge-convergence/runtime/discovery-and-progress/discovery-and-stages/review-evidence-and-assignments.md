# Review evidence and assignments

## Retrieval and assessment

Canonical review retrieves context using bounded terms from actual source paths. Existing Markdown sources also supply headings, cited document paths, and explicit `never` clauses. Planned generated documents that do not yet exist supply only path terms. Unsafe or unreadable existing source bytes fail closed.

Retrieval preserves the knowledge ranker's order and uses a generic repository-knowledge query only when no source supplies a term. This lets pull-request templates retrieve release and publication contracts without filling the review window with unrelated knowledge-lifecycle documents. The eight-document recommendation limit, four linked child documents, exact content hashes, source fence, and independent semantic review still apply. Retrieval supplies evidence; it neither establishes coverage nor approves drafts.

Canonical assessment sends at most four contiguous sources per provider call. It retains every applicable instruction, then fills remaining places in a six-document target with the highest-ranked canonical candidates. The larger retrieval window remains available to independent review. Candidates omitted from assessment cannot be cited as covered. Provider deadlines and reviewed delegation ceilings do not increase. A timed-out provider JSON runner retains its process status so the bounded transient-retry path can distinguish timeout from invalid semantic output.

## Assignments and application

Distinct agents generate, review, write, and integrate under durable provenance-bound assignments. Canonical drafts use a managed detached workspace, verification seal, exact integration ref transition, and exact repository materialization.

Before applying an accepted subset, normalization compares exact sources, review units, semantic checks, candidate bytes, and independently approved output hashes. Rejected families retain exact rejection evidence, do not repeatedly regenerate unchanged output, and do not block another authorized family.
