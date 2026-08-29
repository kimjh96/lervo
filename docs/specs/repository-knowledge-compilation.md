# Repository Knowledge Compilation Specification

Status: `active`
As of: 2026-08-26

## 1. Purpose

Lervo compiles bounded repository evidence whether or not `docs/` exists. Portable Markdown and sidecars remain inspectable without a hosted index.

## 2. Sources

The scanner walks repository files outside explicit VCS, dependency, generated, state, secret, size, and count exclusions. Common Python `.venv` and `venv` dependency environments are excluded at any repository depth, like `node_modules`. It classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agents, policies, hooks, client and tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs and traces, and unsupported binaries.

Ordinary bytes may enter structural extraction. Sensitive log bytes never enter publication or external compilation. Secret candidates are excluded before reading. Presence proves discovery only, not loading, trust, injection, or use.

## 3. Source Units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; structured-data keys; code declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts. Parser failure rejects fine-grained extraction; otherwise, the file is the baseline unit.

## 4. Policy

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

V1 supports only `en`. Language changes generated prose and titles, not identities or user bytes. Neutral localized labels preserve exact encoded paths. Unsupported values fail before planning. A bounded tracked `normalization.exclude` list may keep governed user documents in structural compilation and query while excluding them only from provider rewriting. Exact patterns remain policy-hash inputs and do not become scanner exclusions.

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Explicit ADR metadata outranks title terms. No match or tie blocks migration; there is no implicit `foundation` fallback. Initialization writes a product-neutral taxonomy. Reviewed route changes bind the plan and taxonomy hash.

`docs/archive/**`, `docs/inherited/**`, and exact repository role paths with `relocation: preserve` are canonical preservation boundaries. Their sources remain included in scanning, structural compilation, capacity evaluation, and query. Generic layout migration never relocates them, interprets preserved collection frontmatter as current Lervo route metadata, or rewrites archive or inherited collection bytes through reference repair or provider normalization.

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy and route must exist. Invalid or stale metadata blocks planning.

## 5. Structural Compilation

`lervo.structural@1` is deterministic, bounded, read-only, and tool-free. It produces generated indexes and pages; two-hex-sharded bundle, concept, claim, relation, lineage, and bridge sidecars; a compact current inventory; a source-unit summary; an impact projection; and a manifest binding tracked paths and hashes. It retains no historical full source-unit projections and claims only organization and provenance with `unreviewed` assurance.

Inventory displays the structural publication-input snapshot, excluding revision metadata, verification, events, and local-only agent surfaces. Query and normalization may use broader snapshots without making publication stale. Only manifest validation, lint, and the current migration plan determine currency.

## 6. Entrypoints

Initialization invents no root documents. Before structural publication, canonical instruction bootstrap inspects exact AGENTS and CLAUDE bytes. If AGENTS is absent and CLAUDE is a safe shared candidate, one exact-approved stage creates AGENTS from unchanged CLAUDE bytes plus a separate managed route; CLAUDE remains unchanged. Provider imports or managed blocks make adoption unresolved. Otherwise, first migration creates short English README and AGENTS only when missing. Existing entrypoints remain user-owned until dedicated review.

`knowledge instruction bridge --provider claude` accepts AGENTS only from a bounded instruction or structural hash. An adopted exact duplicate may become the approved thin bridge; mixed user content retains its bytes around one managed import. Structural migration never translates existing bytes.

An active continuation document is not a permanent entrypoint. Before layout migration, a repository-wide bounded scan scores safely included Markdown using name, title, current objective, next action, blocker, state, and active-language signals. Name and location alone never establish the role. One unambiguous or explicitly selected source enters an exact-approved stage that preserves its bytes in CAS, creates `.lervo/state/workstreams/current.json`, and updates resolvable Markdown references. Only the dedicated root legacy `HANDOFF.md` is deleted during continuation migration. Every reviewed user-document deletion retires normalization lifecycle records owned by that exact source path in the same durable operation, preventing stale formatter or lint ownership. An arbitrary continuation source may contain durable knowledge, so its user bytes remain for reviewed normalization and splitting. Multiple candidates block without merging or deletion. With no source, the working agent creates the first snapshot during its terminal turn. The structured snapshot remains outside structural publication; lasting facts belong in routed Markdown.

A byte-preserving exact structure move relocates one current single-output normalization record from source to destination in the same durable transaction, preserving reviewed hashes and compiler provenance. A split normalization family fails closed because a plain move has no reviewed mapping from multiple owned outputs to the destination.

## 7. Bounded Publication Lifecycle

Navigation obeys entry and UTF-8 byte limits. New topics create files; empty categories create no paths. Refresh computes the complete desired set and deletes obsolete output only when the prior generation records its current hash. Edited or unrecorded output conflicts. Cleanup removes empty generated parents.

`.lervo/generated/manifests/current.json` records structural ownership. Refresh replaces it and deletes older valid ID-named structural manifests, but not semantic manifests or immutable review and evidence.

## 8. Semantic Compilation

`knowledge compile --provider codex|claude` runs the installed provider in a temporary directory with filesystem, shell, network, external actions, tools, provider rules, and persistence disabled. The envelope contains untrusted units, exact evidence IDs, and `outputLanguage: en`.

The provider returns schema-valid concepts, claims, and within-response relations citing current versions. Results are `unreviewed`; stability or provider overlap proves neither truth nor consensus.

Exact cross-provider merge is the default derivation. `knowledge fuzzy-merge-candidate` is a separate deterministic local candidate path for concepts having neither exact concept nor exact claim overlap. V1 requires the same concept type, at least one shared evidence-unit version, at least two shared Unicode claim tokens, a Dice score of at least 0.60, and a mutual-best margin of at least 0.10 on both sides. It emits at most 64 one-to-one pairs, retains both provider concepts as `unreviewed`, infers no relation, and makes no provider, embedding, network, or Hub call.

[Document content normalization](document-content-normalization.md) owns provider profiles, section coverage, split rules, protected material, exact per-source approval, lifecycle records, rollback, and stale-output handling. It uses the same capability-free provider boundary after bootstrap, layout, and bridges are current.

## 9. Reconciliation and Review

Reconciliation yields create, register-existing, add-relation, managed-block patch, conflict, or skip. Duplicate, fuzzy-pair, or contradiction resolution requires policy authorization and an exact hash. Both fuzzy-pair members are conflicts; `accept-all-safe` selects neither, and a hash-bound review may accept at most one. Human review is an immutable local CAS artifact. Events retain bounded IDs, hashes, counts, policy coordinates, and decision metadata. User-byte patches require separate exact output-hash approval and never enter `accept-all-safe`.

### Development-Pattern Lifecycle

`knowledge pattern propose` binds at least two independently grouped current source units, exceptions, invariants, reasons, verification, and one responsibility-owned target. Provider identity is observation metadata; equivalent Codex and Claude proposals converge without increasing assurance.

Candidates move through `observed -> candidate -> reviewed -> promoted|rejected|deferred -> superseded`. Exact-hash review and separate promotion bind target hashes, verification, and both agent routes. Promotion creates a missing target or accepts identical bytes; different existing bytes block. Non-check targets extend only the managed AGENTS route consumed by Claude's import.

Candidate and review bodies are immutable CAS artifacts; bounded events rebuild current state. Changed source makes unpromoted work stale and blocks apply, but never rewrites a promoted canonical target.

## 10. Durable Materialization

Validate the plan, stage outputs, back up originals, publish exact bytes and deletions, lint, record the event, and clean the transaction. Pre-event failure restores originals; post-event cleanup failure preserves outputs and requires recovery.

## 11. Concepts, Claims, and Relations

Knowledge query ranks direct concepts lexically and may derive a separate reviewed relation projection for managed context. The projection follows exactly one current human-reviewed relation from a direct concept, examines at most 64 edges, returns at most five distinct targets, and permits at most two graph selections. Each target path must resolve to one concept and one registered document. Its current bytes are hashed at query time and bound to the source snapshot and impact report; concept records do not pretend to store a document content hash. Exact concept and relation sidecar set hashes make the projection rebuildable, while graph coordinates remain outside search-engine scoring and index identity.

Concept sidecars record title, language, type, path, ownership, lifecycle, source versions, assurance, and freshness. Bundle sidecars record language. Claims cite evidence versions. Relations include `depends_on`, `constrains`, `related_to`, `supersedes`, and `contradicts`. Markdown and sidecars are canonical; graph and lexical indexes are rebuildable.

## 12. Impact and Query

Impact compares stored and current versions and marks subjects `current`, `stale`, or `unknown`. Query results are `recommended`; later evidence is required for selection, loading, injection, reference, or use.

## 13. Agent Surfaces

Repository rewriters share the document ownership registry. `lervo_generated`, `managed_blocks`, and reviewed-exact normalization outputs are protected inputs to every formatter, autofix, transform, or generator adapter. `.prettierignore` is a generated and verified adapter projection, not the ownership source. A rewriter without a managed ignore projection must provide a content-bound dry run proving identical before/after hashes for every protected path; an unmanaged rewriter fails closed. User-owned documents are never added to the Lervo-owned set. Shared managed-block documents are protected as whole files from generic rewriters so neither region can be overwritten indirectly.

Recognized surfaces include AGENTS hierarchy; Claude memory, rules, skills, commands, agents, and settings; Codex rules, hooks, configuration, and custom agents; Agent Skills; and supported third-party entrypoints.

Behavioral instructions, portable skills, and reviewable workflows may be semantic sources. Execution policy, hooks, client and tool configuration, provider subagents, local memory, and unknown `.agents/**` remain inventory-only. Migration may merge only versioned Lervo terminal handlers into project arrays after exact approval. Existing provider semantics are not translated. `.agents/rules/**` is not standard. See [ADR-0189](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md).

## 14. Exchange

OKF v0.2 export creates a content-addressed, schema-versioned bundle. Import preserves unknown metadata and original bundle bytes but maps external verification to local `unreviewed`. Hub document sharing uses structured shared-context coordinates plus CAS bytes; repository knowledge exchange uses OKF rather than an opaque upload. Capability packages use their separate kind-tagged envelope. A clone or another installation can lint, query, and re-export without a Hub.

## 15. Failure Meaning

| Failure | Meaning |
| --- | --- |
| source unsafe | Path, symlink, race, or source contract prevents safe reading. |
| limit exceeded | File, byte, unit, nesting, response, or navigation bound exceeded. |
| plan stale | Source, policy, registry, approval, or target changed. |
| reconciliation conflict | Ownership or identity cannot be resolved automatically. |
| approval required | User-byte or conflict operation lacks exact authorization. |
| apply failed | Commit failed and pre-event bytes were restored. |
| recovery required | Interrupted or post-commit transaction requires recovery. |
| lint failed | Publications, sidecars, manifests, or bridges disagree. |

## 16. Acceptance

1. Migration, not initialization, gives an undocumented repository English README and AGENTS entrypoints and a cited bundle.
2. Structural routing precedes exact per-source-approved rewrites from stored candidates.
3. Coverage includes code, configuration, tests, evidence, log metadata, and unsupported files.
4. Large categories shard below both bounds; owned obsolete pages disappear safely.
5. Malicious text cannot trigger tools, network, writes, or provider customization.
6. Codex and Claude pass the same no-capability contract.
7. Semantic changes require reconciliation and human review.
8. Apply and recovery pass failure injection.
9. Lint succeeds and immediate replan has no changed operations.
10. A clean clone reproduces tracked knowledge without a Hub.
11. Ambiguous or unclassified ADRs fail closed and leaves respect bounds.
12. Eligible Markdown, including portable skills, enters language and format lifecycle; immediate replan is current, while changed resources become stale.
13. Fuzzy cross-provider candidates fail closed on weak or ambiguous matches and cannot materialize both pair members.

## References

- [Repository knowledge decision](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [OKF exchange decision](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md)
- [Instruction bridge decision](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
- [Agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Language-aware bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Repository-scoped decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md)
- [Reviewed document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Approval-gated cross-provider fuzzy merge](../decisions/knowledge/semantics/0227-approval-gated-cross-provider-fuzzy-merge.md)
- [Fail-closed provider terminal integration](../decisions/execution/providers/0196-fail-closed-provider-terminal-integration.md)
