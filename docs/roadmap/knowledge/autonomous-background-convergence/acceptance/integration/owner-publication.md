# Owner publication

- [ ] Settled knowledge reaches the shared remote from whichever host owns convergence under [ADR-0466](../../../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) publication.

Implemented and source-tested against a bare Git remote and a fake pull request host. Tests cover:

- Direct and replayed tips.
- Replay onto a moved base when only knowledge commits exist.
- Supersession of stale commits that conflict with the current base.
- Recreation of an externally closed pull request.
- Merge after passing checks.
- Local fast-forward and the equivalent reset.
- Scope refusal, failed checks, disabled merging, non-owner refusal, and fetch failure.
- One push across cycles with unchanged input, through date-preserving replay or an equivalent remote head.
- A success-only merge gate: neutral or cancelled checks block, and a merge refused for pending checks keeps waiting.
- `gh <step> exit <code> <class>` failure details.
- Formatting of changed and released paths, before the owner commits and on the publication tip.

Installed acceptance remains open: one owner-published pull request merged from each host, with local `main` equal to `origin/main` afterward on both hosts.
