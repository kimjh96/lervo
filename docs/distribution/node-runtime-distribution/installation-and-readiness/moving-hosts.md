# Moving a repository Node to another host

Stop the old Node before copying mutable state. Do not start both hosts against one deployment identity.

A repository clone with tracked files is insufficient. Transfer both state authorities as owner-only data, preserving their repository and project marker files exactly:

- `.lervo/` contains repository-local event, CAS, knowledge, and workstream state.
- Hired agents and assignments use the repository-instance coordination home: `<git-common-dir>/lervo-coordination-v1` for a Git worktree, or `.lervo/data/repository-coordination-v1` for a standalone checkout.

Copy provider and Discord credentials separately into the destination's configured owner-only paths. Never place credentials in either state authority.

Before activation, inspect the destination organization and agent projections and run `--check-config`. Do not accept a newly initialized empty coordination home as equivalent to the source.

After the destination reports stable service-manager and runtime readiness, keep the old service disabled. Repeat this single-writer handoff for every later move. Shared network storage or simultaneous Nodes cannot substitute for an explicit active-host lease.
