# Owner publication

- [ ] Settled knowledge reaches the shared remote from whichever host owns convergence under ADR-0466 publication.

Implemented and source-tested against a bare Git remote and a fake pull request host. Tests cover:

- Direct and replayed tips.
- Replay onto a moved base when only knowledge commits exist.
- Supersession of stale commits conflicting with the current base.
- Recreation of an externally closed pull request.
- Merge after passing checks.
- Local fast-forward and the equivalent reset.
- Scope refusal, failed checks, disabled merging, non-owner refusal, and fetch failure.
- One push across cycles with unchanged input, through date-preserving replay or an equivalent remote head.
- A success-only merge gate: neutral or cancelled checks block; a merge refused for pending checks keeps waiting.
- `gh <step> exit <code> <class>` failure details.
- Formatting changed and released paths before the owner commits and on the publication tip.
- [ADR-0468](../../../../../decisions/coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md) supersession across a simulated two-host replica: both checkouts converge to the remote base without resurrecting superseded commits; a developer commit above them holds replication with one attention item; repeated cycles change nothing.

- [ADR-0473](../../../../../decisions/knowledge/documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) scope and repair. Delegated normalization roots outside `docs/` publish. An out-of-scope knowledge commit is restored in one corrective commit with one `knowledge.publication.repaired` event. A published release-please changelog rewrite is restored and its normalization record retired. A path a developer also changed is refused with `developer_change`. Derived settings take the base from `ls-remote --symref`, are revalidated, and migrate from fixed roots.

## Open installed acceptance

One owner-published pull request must merge from each host, leaving local `main` equal to `origin/main` on both hosts. After an installed supersession, both checkouts must remain at `origin/main` across later replica cycles.

Under ADR-0473, the WSL owner of the repository blocked by `knowledge_publication_scope_violation` must publish without operator configuration. Its `release-please` changelogs must return to their tool-written bytes in one repair commit. The derived publication base on every host must match the remote's advertised default branch.
