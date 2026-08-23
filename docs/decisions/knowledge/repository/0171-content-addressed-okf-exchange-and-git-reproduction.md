# ADR-0171: Content-Addressed OKF Exchange and Git Reproduction

- Status: accepted
- Decision date: 2026-08-22

## Context

OKF v0.2 is exchange, not native storage. Import must preserve unknown metadata and footnotes without elevating external verified status. Clean clones must validate/query tracked publications and sidecars without gitignored local knowledge state.

## Decision

@lervo/knowledge-okf deterministically exports native concepts/sidecars into a new index.md and concept Markdown with standard fields, claim footnotes, and x_lervo provenance, without modifying native sources or overwriting output.

Import defaults to a read-only plan. After bounded safe UTF-8/front-matter/content-hash rescan and identical plan ID, apply records only an immutable .lervo/state/knowledge/okf-imports candidate. It preserves exact Markdown bytes and all metadata, separately identifying unknown keys. External verified becomes externalTrust while localAssurance remains unreviewed. Import emits no event and grants no native publication/review authority.

Lint/query read bundles directly and report recommended only. Same-candidate re-export writes preserved bytes exactly, retaining bundle digest and unknown metadata.

Structural manifests bind only Git-carried Markdown and .lervo/knowledge sidecars. Rebuildable .lervo/state/knowledge inventories, units, and impacts are excluded from clone-required output. Stable evidenceUnitIds let a clean clone recompute current/stale/missing; legacy version-only inputs remain unknown.

Scans cap 512 Markdown files, 4 MiB each, 64 MiB total, and reject unsafe paths/types, symlinks, races, invalid UTF-8/YAML, and duplicate keys. Output requires a safe parent and absent target; failures remove only output created by that call. Plan IDs bind project, candidate, bundle digest, and target. Errors expose no source bodies or secrets.

## Consequences

Fixtures verify deterministic export, overwrite/symlink/stale rejection, byte-identical unknown metadata and lifecycle round trips, and no assurance elevation. A real Git commit/clone reproduces native lint/query and OKF digest; CLI export/plan/apply/query/re-export works without Hub or events.
