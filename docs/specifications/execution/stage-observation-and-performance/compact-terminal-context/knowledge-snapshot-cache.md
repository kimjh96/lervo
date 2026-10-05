# Knowledge snapshot identity cache

`apps/cli/src/terminal-compact-context.ts` stores a knowledge snapshot coordinate at `.lervo/state/cache/terminal-knowledge-snapshot.json`, separate from the repository stat-identity and knowledge lifecycle inspection caches.

The record contains schema version 1, repository revision, project ID, policy ID, and source snapshot ID. Reading catches parse and filesystem failures and requires schema version 1 and a source snapshot ID matching `ksnap_` followed by 24 lowercase hexadecimal characters. It does not enforce an exact property set. Reuse also requires matching the requested repository revision and loaded project and policy IDs.

A miss runs `scanConfiguredRepositoryKnowledge`. Before cache publication, another terminal repository snapshot must match the requested revision. Publication creates the parent directory with requested mode `0700`, writes a PID-suffixed temporary file with requested mode `0600`, and renames it to the cache path. Write failures are ignored. These mode arguments do not establish permissions of an existing directory.

Revision disagreement prevents publication, but the function still returns the scan's snapshot ID. This guard does not independently prove that every returned scan came from an unchanged repository. The cache stores coordinates, not source bodies, and is not a lifecycle-current receipt.
