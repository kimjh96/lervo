# Repository Knowledge Compilation Specification

Status: `active`  
As of: 2026-08-23

## 1. Purpose

Lervo compiles bounded repository evidence whether or not `docs/` exists. Its portable Markdown and sidecars remain inspectable without an opaque hosted index.

## 2. Sources

The scanner walks repository files outside explicit VCS, dependency, generated, state, secret, size, and count exclusions. It classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agent definitions, policies, hooks, client or tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs or traces, and unsupported binaries.

Ordinary bytes may enter local structural extraction. Sensitive log bytes never enter publication or an external semantic compiler. Secret candidates are excluded before content is read. Presence proves discovery only, not loading, trust, injection, or use.

## 3. Source units

Each source has a stable ID and content-bound version. Adapters may emit bounded Markdown sections; JSON or YAML key paths; JavaScript or TypeScript declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification results; privacy-valid events; and validated skill contract content.

Parser failure rejects the affected extraction instead of claiming complete fine-grained coverage. The file remains the baseline unit when no specialized adapter applies.

## 4. Policy

Tracked `.lervo/knowledge/policy.yaml` includes:

```yaml
publicationRoot: docs/knowledge
publication:
  language: en
  maxNavigationEntries: 24
  maxNavigationBytes: 8192
```

V1 supports only `en`. Language affects generated prose and navigation titles, not source identity or user bytes. Incompatible titles receive localized neutral labels while exact encoded paths remain visible. Unsupported values fail before planning.

`.lervo/knowledge/document-layout.yaml` separately declares canonical and legacy decision roots, leaf bounds, and repository semantic routes. Explicit ADR metadata outranks deterministic title terms. No match or an equal strongest match blocks migration; there is no implicit `foundation` fallback.

Initialization writes a product-neutral starter taxonomy. Repositories do not inherit Lervo-specific domains. Reviewed route changes are bound by the migration plan and taxonomy hash.

An ADR may declare a configured route without changing its heading or body:

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy and route must exist in current configuration. Invalid or stale metadata blocks planning.

## 5. Structural compilation

`lervo.structural@1` is deterministic, bounded, read-only, and tool-free. It produces:

- `docs/knowledge/index.md` and indexes for non-empty categories;
- bounded numbered pages and optional catalogs;
- two-hex-sharded bundle, concept, claim, relation, lineage, and bridge sidecars under `.lervo/knowledge/`;
- inventory, source-unit, and impact projections under `.lervo/state/knowledge/`;
- a generation manifest binding canonical paths and hashes.

It claims organization and provenance only, with `unreviewed` assurance.

## 6. Entrypoints

Initialization does not invent root documents. On first migration, missing README and AGENTS files receive short English human and provider-neutral entrypoints. Existing README, AGENTS, and CLAUDE files remain user-owned until reviewed normalization. A missing or stale CLAUDE bridge is handled by `knowledge instruction bridge --provider claude`. That bridge accepts AGENTS bytes only from a bounded included instruction or a hash recorded by structural generation.

Structural migration never translates or replaces existing entrypoint bytes. Normalization uses the human profile for README, provider-neutral agent profile for AGENTS, and a thin provider-bridge profile for CLAUDE while preserving its managed import.

## 7. Bounded publication lifecycle

Every navigation page satisfies configured entry and UTF-8 byte limits. New topics create files rather than append-only sections; empty categories create no path.

Refresh calculates the complete desired set. It deletes an obsolete output only when a prior structural generation records its current hash. Edited or unrecorded outputs conflict. Successful cleanup removes empty generated parents.

`.lervo/generated/manifests/current.json` records structural ownership. Refresh replaces that validated manifest and deletes older valid ID-named structural manifests. It does not compact semantic manifests or immutable review and evidence records.

## 8. Semantic compilation

`knowledge compile --provider codex|claude` runs an installed provider in a temporary directory with filesystem, shell, network, external actions, tools, provider rules, and session persistence disabled. The envelope contains untrusted units, exact evidence IDs, and `outputLanguage: en`.

The provider returns schema-valid concepts, claims, and within-response relations citing current source-unit versions. Results are `unreviewed`; stability or provider overlap proves neither truth nor consensus.

### Document content normalization

After structural layout and bridges are current, `migrate knowledge --provider codex|claude` uses the same empty no-capability boundary to return bounded Markdown rewrites, not claims.

V1 includes ordinary `.md` files outside generated navigation and distinguishes profiles for README, agent instructions, bridges, portable skills and references, decisions, product, architecture, specifications, roadmaps, instructions, and general documents. Output follows `publication.language`; v1 accepts `en`.

Every input retains an output at its current path. Allowed splits remain in the declared grouped directory: root handoffs use `docs/repository/handoffs/`; ordinary documents use a sibling directory named for the source stem. Every output has one H1 and obeys its byte and line bounds. Provider bridges additionally stay below 2 KiB and 40 lines.

Coverage assigns every source section to exactly one output through complete, non-foreign document-local integer indexes. Lervo resolves those indexes to content-bound source-unit version IDs. Validation preserves instruction path-scope frontmatter, managed blocks, provider imports, Agent Skill `name`, fenced examples and links in skills or instructions, and inline coordinates in portable skill material. Root README routes agents to `AGENTS.md`; legacy wiki links become portable Markdown links. Skill descriptions may follow publication language without changing identity. Canonical instruction frontmatter remains exact. Other condensation belongs to exact human review. Skill resource hashes join lifecycle and approval bindings, but scripts and assets are not rewritten.

Candidates and schema-valid shard responses reside in ignored local state. Cache identity binds the complete envelope and compiler build, so changed inputs or instructions invalidate resumable results. Plans bind exact candidate bytes and require per-source approval. Apply never reruns the provider: it writes candidate outputs and sharded lifecycle records through the durable journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

Records bind exact output hashes and a user-region hash excluding managed blocks, so managed route refresh does not stale unchanged prose. Replacement removes older active records for the source. Apply lint tolerates only the expected stale instruction-bridge binding as a transition warning; immediate bridge and structural refresh must restore ordinary validity. Other lint errors roll back. Later user-region, output, or skill-resource mismatches become stale and require new review.

## 9. Reconciliation and review

Reconciliation compares candidates with the current registry and yields create, register existing, add relation, managed-block patch, conflict, or skip dispositions. Duplicate and contradiction resolutions require policy authorization and an exact resolution hash.

Human review is an immutable local CAS artifact. Events contain bounded identifiers, hashes, counts, policy coordinates, and decision metadata. User-byte patches require separate exact output-hash approval and never enter `accept-all-safe`.

## 10. Durable materialization

Materialization validates the current plan, stages outputs, backs up originals, publishes exact bytes or deletions, runs deterministic lint, records the event, and cleans the transaction. Pre-event failure restores originals; post-event cleanup failure preserves committed outputs and requires recovery.

## 11. Concepts, claims, and relations

Concept sidecars record title, publication language, type, publication path, ownership, lifecycle, source-unit versions, assurance, and freshness. Bundle sidecars also record language. Claims contain source-backed statements and evidence versions. Relations use bounded terms including `depends_on`, `constrains`, `related_to`, `supersedes`, and `contradicts`.

Markdown and sidecars are canonical. Graph and lexical indexes are rebuildable.

## 12. Impact and query

Impact compares stored and current evidence versions and marks dependent subjects `current`, `stale`, or `unknown`. Query results are `recommended`; later evidence is required for selection, loading, injection, reference, or use.

## 13. Agent surfaces

Lervo recognizes documented AGENTS hierarchy; Claude memory, rules, skills, commands, agents, and settings; Codex rules, hooks, configuration, and custom agents; Agent Skills; and supported third-party entrypoints.

Behavioral instructions, portable skills, and reviewable workflows may be semantic sources. Execution policy, hooks, client or tool configuration, provider subagents, local memory, and unknown `.agents/**` remain inventory only. `.agents/rules/**` is not a standard rules location.

See [ADR-0189](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md).

## 14. Exchange

OKF v0.2 export projects publications and sidecars into a content-addressed bundle. Import preserves unknown metadata and original bundle bytes but maps external verification to local `unreviewed`. A clone or another Lervo installation can lint, query, and re-export without a Hub.

## 15. Failure meaning

| Failure | Meaning |
|---|---|
| source unsafe | Path, symlink, race, or source contract prevents safe reading. |
| limit exceeded | A file, byte, unit, nesting, response, or navigation bound was exceeded. |
| plan stale | Source, policy, registry, approval, or target changed after planning. |
| reconciliation conflict | Ownership or semantic identity cannot be resolved automatically. |
| approval required | A user-byte or conflict operation lacks exact authorization. |
| apply failed | Commit failed and pre-event bytes were restored. |
| recovery required | An interrupted or post-commit transaction requires recovery. |
| lint failed | Canonical publications, sidecars, manifests, or bridges disagree. |

## 16. Acceptance

1. Migration, not initialization, gives an undocumented repository English README and AGENTS entrypoints plus a cited bundle.
2. Structural routing precedes exact, per-source-approved rewrites from stored candidates.
3. Coverage honestly includes code, configuration, tests, evidence, log metadata, and unsupported files.
4. Large categories shard below both bounds; owned obsolete pages disappear safely.
5. Malicious text cannot trigger tools, network, writes, or provider customization.
6. Codex and Claude pass the same no-capability contract.
7. Semantic changes require reconciliation and human review.
8. Apply and recovery pass failure injection.
9. Lint succeeds and immediate replan reports no changed operations.
10. A clean clone reproduces tracked knowledge without a Hub.
11. Ambiguous or unclassified ADRs fail closed, and leaves respect configured bounds.
12. Eligible Markdown, including portable skill prose, enters the language and format lifecycle; immediate normalization replan is current, while changed skill resources become stale.

## References

- [Repository knowledge decision](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [OKF exchange decision](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md)
- [Instruction bridge decision](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
- [Agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Language-aware bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Repository-scoped decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md)
- [Reviewed document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
