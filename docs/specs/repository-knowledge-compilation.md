# Repository Knowledge Compilation Specification

Status: `active`
As of: 2026-08-23

## 1. Purpose

Lervo compiles repository knowledge from bounded evidence regardless of whether a repository has a `docs/` directory. The result is portable Markdown plus sidecars, not an opaque hosted index.

## 2. Sources

The scanner walks repository files outside explicit VCS, dependency, generated, state, secret, size, and count exclusions. It classifies:

- documentation and agent instructions;
- code, configuration, schemas, tests, build and automation sources;
- skills, workflows, agent definitions, execution policy, hooks, and client/tool configuration;
- revision identity, verified result artifacts, and allowlisted execution events;
- logs and traces as sensitive inventory;
- unsupported binary files as metadata-only coverage.

Ordinary source bytes may enter local structural extraction. Sensitive log bytes never enter generated publication or an external semantic compiler. Secret-candidate bytes are excluded before reading content.

File presence proves discovery only. It does not prove that an agent loaded, trusted, injected, or used the source.

## 3. Source units

Each source has a stable source ID and content-bound version. Adapters may emit exact bounded units:

- Markdown heading sections;
- JSON and YAML key paths;
- JavaScript and TypeScript declarations and named members;
- CSS rules, named at-rules, and custom properties;
- Git `HEAD` revision identity;
- verification results and privacy-valid execution events;
- validated project skill contract content.

A parser failure rejects the affected extraction rather than silently claiming complete fine-grained coverage. A file unit remains the baseline when no specialized adapter applies.

## 4. Policy

Tracked policy lives at `.lervo/knowledge/policy.yaml` and includes:

```yaml
publicationRoot: docs/knowledge
publication:
  language: en
  maxNavigationEntries: 24
  maxNavigationBytes: 8192
```

Version 1 supports only `en`. The language tag affects all generated prose and navigation titles, not source identity or user-owned bytes. A source title that conflicts with the selected language receives a localized neutral label while its exact encoded path remains visible. Unsupported values fail before planning.

Decision layout is a separate tracked concern at `.lervo/knowledge/document-layout.yaml`. It declares the canonical and legacy roots, leaf bound, and repository-specific semantic routes. Explicit ADR route metadata takes precedence; deterministic title terms are only a routing aid. No match or an equal strongest match blocks migration instead of falling back to `foundation`.

Fresh initialization writes only a product-neutral starter taxonomy. Lervo-specific domains are not inherited by external repositories. Because the configuration is tracked, an agent or owner may tailor its routes to repository evidence before migrating decisions; the migration plan and taxonomy hash then bind that reviewed choice.

An ADR that cannot be classified confidently can declare its configured route without changing the heading or body:

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy ID and route must exist in the current repository configuration. Invalid or stale metadata blocks planning.

## 5. Structural compilation

`lervo.structural@1` is deterministic, bounded, read-only, and tool-free. It creates:

- `docs/knowledge/index.md` as the short repository knowledge entrypoint;
- category indexes only for non-empty categories;
- numbered pages and optional catalogs when a category exceeds limits;
- two-hex-sharded bundle, concept, claim, relation, lineage, and bridge sidecars under `.lervo/knowledge/`;
- local inventory, source-unit, and impact projections under `.lervo/state/knowledge/`;
- a generation manifest binding canonical output paths and hashes.

Structural compilation claims organization and provenance only. Its assurance is `unreviewed`.

## 6. Entrypoints

Initialization does not invent root documents. On first migration:

- a missing README receives a short human-oriented English starting point;
- a missing AGENTS receives short provider-neutral agent instructions;
- an existing README, AGENTS, or CLAUDE remains user-owned and byte-identical;
- a missing or stale CLAUDE bridge is handled by `knowledge instruction bridge --provider claude`, not ordinary migration;
- the bridge accepts canonical AGENTS bytes only when they are a bounded included instruction or their exact current hash appears in a recorded structural generation.

An existing entrypoint rewrite requires a reviewed semantic candidate or an explicit user-authorized edit. Structural migration never translates or replaces its bytes.

## 7. Bounded publication lifecycle

Every generated navigation page must satisfy both configured entry and UTF-8 byte limits. New topics create new files rather than append-only sections. Empty categories have no file or directory.

Refresh computes the complete desired output set. An obsolete generated path is deleted only when its current hash appears in a prior structural generation. A user-edited or unrecorded path becomes a conflict. Successful cleanup removes now-empty generated parent directories.

Structural ownership is recorded at `.lervo/generated/manifests/current.json`. Refresh replaces that exact validated manifest and deletes older valid ID-named structural manifests. Semantic manifests and immutable review/evidence records are not compacted by structural migration.

## 8. Semantic compilation

`knowledge compile --provider codex|claude` runs an installed provider in a temporary directory with filesystem, shell, network, external actions, tools, provider rules, and session persistence disabled by contract. The envelope contains untrusted source units, exact evidence IDs, and `outputLanguage: en`.

The provider returns only schema-valid concepts, claims, and within-response relations. Every claim and relation cites current source-unit versions. Output is `unreviewed`; stability or cross-provider overlap is not truth or consensus.

## 9. Reconciliation and review

Reconciliation compares a candidate with the current registry and produces dispositions such as create, register existing, add relation, propose managed-block patch, conflict, or skip. Duplicate and contradiction resolutions require policy authorization and an exact resolution hash.

Human review is stored as an immutable local CAS artifact. Events contain only bounded identifiers, hashes, counts, policy coordinates, and decision metadata. Existing user-byte patches require a separate exact output-hash approval and are never included in `accept-all-safe`.

## 10. Durable materialization

Materialization validates the same current plan, stages outputs, backs up originals, publishes exact bytes or deletions, runs deterministic lint, records the event, and cleans the transaction. Pre-event failure rolls back; post-event cleanup failure preserves committed output and requires explicit recovery.

## 11. Concepts, claims, and relations

A concept sidecar identifies title, publication language, type, publication path, ownership, lifecycle, source-unit versions, assurance, and freshness. The bundle sidecar also records publication language. Claims contain source-backed statements and evidence unit versions. Relations use a bounded vocabulary such as `depends_on`, `constrains`, `related_to`, `supersedes`, and `contradicts`.

Markdown and sidecars are canonical. Graph and lexical query indexes are rebuildable projections.

## 12. Impact and query

Impact compares stored evidence versions with the current scan and marks only dependent subjects `current`, `stale`, or `unknown`. Query results are `recommended`. Selection, loading, injection, reference, and use require later lifecycle evidence.

## 13. Agent surfaces

Lervo recognizes exact documented paths for AGENTS hierarchy, Claude memory/rules/skills/commands/agents/settings, Codex rules/hooks/config/custom agents, Agent Skills packages, and supported third-party instruction entrypoints.

Behavioral instructions, portable skills, and reviewable workflows may be semantic sources. Execution policy, hooks, client/tool configuration, provider subagents, local memory, and unknown `.agents/**` remain local inventory only. `.agents/rules/**` is not treated as a standard rules location.

See [ADR-0189](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md).

## 14. Exchange

OKF v0.2 export projects native publications and sidecars into a content-addressed bundle. Import preserves unknown metadata and original bundle bytes but maps external verification to local `unreviewed`. Git clone or another Lervo installation can lint, query, and re-export without a Hub.

## 15. Failure meaning

| Failure | Meaning |
|---|---|
| source unsafe | Path, symlink, race, or source contract prevents safe reading. |
| limit exceeded | A configured file, byte, unit, nesting, response, or navigation bound was exceeded. |
| plan stale | Source, policy, registry, approval, or target changed after planning. |
| reconciliation conflict | Ownership or semantic identity cannot be resolved automatically. |
| approval required | A user-byte or conflict operation lacks exact authorization. |
| apply failed | The transaction could not commit and pre-event bytes were restored. |
| recovery required | An interrupted or post-commit transaction needs explicit recovery. |
| lint failed | Canonical publications, sidecars, manifests, or bridges disagree. |

## 16. Acceptance

1. A repository with no documents produces English README, AGENTS, and a cited knowledge bundle during migration, not initialization.
2. Scattered documents and provider surfaces are discovered while user bytes remain unchanged.
3. Code, configuration, tests, evidence, log metadata, and unsupported files appear in honest coverage.
4. Large categories shard below both bounds and obsolete pages disappear safely.
5. Malicious source text cannot trigger tools, network, writes, or provider customization.
6. Codex and Claude pass the same no-capability compiler contract.
7. Semantic changes require reconciliation and human review.
8. Apply and recovery pass failure-injection tests.
9. Lint succeeds and an immediate replan has zero changed operations.
10. A clean clone or another Lervo reproduces tracked knowledge without a Hub.
11. Unclassified or ambiguous ADRs fail closed, and no configured decision leaf exceeds its tracked bound.

## References

- [Repository knowledge decision](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [OKF exchange decision](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md)
- [Instruction bridge decision](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
- [Agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Language-aware bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Repository-scoped decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md)
