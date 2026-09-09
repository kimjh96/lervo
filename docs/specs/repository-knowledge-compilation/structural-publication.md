# Sources, Policy, and Structural Publication

## Sources

The scanner walks repository files except explicit VCS, dependency, generated, state, secret, size, and count exclusions. It excludes Python `.venv` and `venv` directories at every depth, like `node_modules`. Finder `.DS_Store` files and regular AppleDouble `._*` sidecars are transport metadata, so scans and internal knowledge registries ignore them. Directories or symbolic links with those names remain subject to normal fail-closed safety checks.

It classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agents, policies, hooks, client and tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs and traces, and unsupported binaries.

Ordinary bytes may enter structural extraction. Sensitive log bytes never enter publication or external compilation. Secret candidates are excluded before reading. Discovery proves presence only, not loading, trust, injection, or use.

## Source units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; structured-data keys; code declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts. Parser failure rejects fine-grained extraction; otherwise, the file is the baseline unit.

## Policy

Tracked `.lervo/knowledge/policy.yaml` includes:

```yaml
publicationRoot: docs/knowledge
publication:
  language: en
  maxNavigationEntries: 24
  maxNavigationBytes: 8192
normalization:
  exclude: []
```

V1 supports only `en`. Language affects generated prose and titles, not identities or user bytes. Neutral localized labels preserve exact encoded paths. Unsupported values fail before planning.

A bounded tracked `normalization.exclude` list may exclude governed user documents from provider rewriting only; structural compilation and query retain them. Exact patterns remain policy-hash inputs and never become scanner exclusions.

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Explicit ADR metadata outranks title terms. No match or tie blocks migration; there is no implicit `foundation` fallback. Initialization writes a product-neutral taxonomy. Reviewed route changes bind the plan and taxonomy hash.

`docs/archive/**`, `docs/inherited/**`, and exact repository role paths with `relocation: preserve` are canonical preservation boundaries. Scanning, structural compilation, capacity evaluation, and query retain their sources. Generic layout migration never relocates them, interprets preserved collection frontmatter as current Lervo route metadata, or rewrites archive or inherited collection bytes through reference repair or provider normalization.

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy and route must exist. Invalid or stale metadata blocks planning.

## Structural compilation

`lervo.structural@2` is deterministic, bounded, read-only, and tool-free. It produces generated indexes and pages; two-hex-sharded structural bundles and concepts; a compact current inventory; a source-unit summary; an impact projection; and one manifest binding generated paths and hashes.

Rebuildable outputs live below ignored `.lervo/state/knowledge/current/` or the ignored configured publication root. Reviewed claims, relations, concepts, lineage, bridges, normalization records, and semantic manifests remain tracked canonical records. The compiler retains no historical full source-unit projections and claims only organization and provenance with `unreviewed` assurance.

A bounded read-only lifecycle inspection may share one prepared scan with instruction, layout, structural, bridge, normalization, and lint consumers. Each validates project and policy coordinates; the scan cannot survive repository mutation.

The direct-terminal host may cache the resulting knowledge-only issue projection in `.lervo/state`, keyed by exact CLI version, repository snapshot revision, and supplemental-source digest. This disposable derived state is neither a canonical knowledge record nor a completion event.

Inventory displays the structural publication-input snapshot, excluding revision metadata, verification, events, and local-only agent surfaces. Query and normalization may use broader snapshots without making publication stale. Only manifest validation, lint, and the current migration plan determine currency.

## Bounded publication lifecycle

Navigation obeys entry and UTF-8 byte limits. New topics create files; empty categories create no paths. Refresh computes the complete desired set and deletes obsolete output only when the prior generation records its current hash. Edited or unrecorded output conflicts. Cleanup removes empty generated parents.

`.lervo/state/knowledge/current/structural/manifests/current.json` records structural ownership. Refresh replaces it and deletes exact-hash legacy structural manifests and structural outputs during schema-2 migration, but preserves semantic manifests and immutable review and evidence.
