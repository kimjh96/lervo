# Owner publication

- [ ] Settled knowledge reaches the shared remote from whichever host owns convergence under ADR-0466 publication.

Implemented and source-tested against a bare Git remote and a fake pull request host. Tests cover:

- Direct and replayed tips.
- Replay onto a moved base when only knowledge commits exist.
- Supersession of stale commits that conflict with the current base.
- Recreation of an externally closed pull request.
- Merge after passing checks.
- Local fast-forward and the equivalent reset.
- Scope refusal, failed checks, disabled merging, non-owner refusal, and fetch failure.
- One push across cycles with unchanged input, through date-preserving replay or an equivalent remote head.
- A success-only merge gate: neutral or cancelled checks block; a merge refused for pending checks keeps waiting.
- `gh <step> exit <code> <class>` failure details.
- Formatting of changed and released paths before the owner commits and on the publication tip.
- [ADR-0468](../../../../../decisions/coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md) supersession across a simulated two-host replica: both checkouts converge to the remote base without resurrecting superseded commits; a developer commit above them holds replication with one attention item; repeated cycles change nothing.

## Open installed acceptance

One owner-published pull request must merge from each host, leaving local `main` equal to `origin/main` on both hosts. After an installed supersession, both checkouts must remain at `origin/main` across later replica cycles.
