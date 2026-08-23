# ADR-0171: Content-Addressed OKF Exchange and Git Reproduction

- Status: accepted
- Decision date: 2026-08-22

## Context

OKF v0.2 is an exchange format, not native storage. Imports must preserve unknown metadata and footnotes without elevating externally verified status. Clean clones must validate and query tracked publications and sidecars without gitignored local knowledge state.

## Decision

`@lervo/knowledge-okf` deterministically exports native concepts and sidecars into a new `index.md` and concept Markdown files containing standard fields, claim footnotes, and `x_lervo` provenance. It neither modifies native sources nor overwrites output.

Import defaults to a read-only plan. Apply proceeds only after a bounded, safe UTF-8/front-matter/content-hash rescan produces the identical plan ID. It records only an immutable `.lervo/state/knowledge/okf-imports` candidate, preserving exact Markdown bytes and all metadata while separately identifying unknown keys. External verified status becomes `externalTrust`; `localAssurance` remains unreviewed. Import emits no event and grants no native publication or review authority.

Lint and query read bundles directly and report recommended status only. Re-exporting the same candidate writes the preserved bytes exactly, including the bundle digest and unknown metadata.

Structural manifests bind only Git-carried Markdown and `.lervo/knowledge` sidecars. Rebuildable `.lervo/state/knowledge` inventories, units, and impacts are excluded from clone-required output. Stable `evidenceUnitIds` let a clean clone recompute current, stale, or missing status; legacy version-only inputs remain unknown.

Scans allow at most 512 Markdown files, 4 MiB per file, and 64 MiB total. They reject unsafe paths or types, symlinks, races, invalid UTF-8 or YAML, and duplicate keys. Output requires a safe parent and an absent target. Failure removes only output created by that call. Plan IDs bind project, candidate, bundle digest, and target. Errors expose no source bodies or secrets.

## Consequences

Fixtures verify deterministic export; overwrite, symlink, and stale rejection; byte-identical unknown-metadata and lifecycle round trips; and no assurance elevation. A real Git commit and clone reproduce native lint/query results and the OKF digest. CLI export, plan, apply, query, and re-export work without Hub or events.
