# Repository Snapshots, Writes, and Verification

## Snapshots and writes

Plans bind state, expected paths, before and desired hashes, and verification. Apply rejects symlinks, escapes, changed targets, unapproved paths, and stale plans.

Every managed-write provider turn receives the exact repository-relative target path and an instruction to change only that path, in both single-file and multi-file schedules. Write authorization and byte verification remain authoritative.

Snapshots cover repository-authored source and tracked generated files. They exclude runtime data and state, dependencies, and conventional generated build or cache directories, including Python `.venv` and `venv` dependency environments at any depth. Excluded environments do not consume the snapshot file-count or byte budget; the limit still applies to included repository files. User content changes only through explicit content-bound operations. Managed blocks preserve outside bytes. Generated files may change or be deleted only when recorded generation proves current-hash ownership.

Repository assignments bind role, dependency, acceptance, verification, approval, workstream, and path coordinates. Short atomic leases serialize overlapping scopes; disjoint root agents and subagents share one lease and handoff contract. Managed execution revalidates lease, provider, role, path, and suite authority before provider creation. Generation-bound expiry permits recovery but never proves former external work stopped.

Assignment interactions, routines, and connectors have separate specifications. The governed loops specification defines bounded continuation.

## Verification

Suites declare exact commands, working directories, limits, and outcomes. Lervo compares pre- and post-snapshots and rejects unexpected changes. Bounded command output is artifact data, not event content.
