# Repository Knowledge Compilation Specification

Status: `active`
As of: 2026-08-26

## 1. Purpose

Lervo compiles bounded repository evidence whether or not `docs/` exists. Portable Markdown and sidecars remain inspectable without a hosted index.

## 2. Sources

The scanner walks repository files outside explicit VCS, dependency, generated, state, secret, size, and count exclusions. It classifies documentation, instructions, code, configuration, schemas, tests, automation, skills, workflows, agents, policies, hooks, client and tool configuration, revision identity, verified artifacts, allowlisted events, sensitive logs and traces, and unsupported binaries.

Ordinary bytes may enter structural extraction. Sensitive log bytes never enter publication or external compilation. Secret candidates are excluded before reading. Presence proves discovery only, not loading, trust, injection, or use.

## 3. Source units

Sources have stable IDs and content-bound versions. Adapters may emit bounded Markdown sections; JSON or YAML keys; JavaScript or TypeScript declarations and members; CSS rules, named at-rules, and custom properties; Git `HEAD`; verification; privacy-valid events; and validated skill contracts. Parser failure rejects affected extraction rather than claiming fine-grained completeness; otherwise, the file is the baseline unit.

## 4. Policy

Tracked `.lervo/knowledge/policy.yaml` includes:

```yaml
publicationRoot: docs/knowledge
publication:
  language: en
  maxNavigationEntries: 24
  maxNavigationBytes: 8192
```

V1 supports only `en`. Language changes generated prose and titles, not identities or user bytes. Neutral localized labels preserve exact encoded paths. Unsupported values fail before planning.

`.lervo/knowledge/document-layout.yaml` declares decision roots, leaf bounds, and semantic routes. Explicit ADR metadata outranks title terms. No match or tie blocks migration; there is no implicit `foundation` fallback. Initialization writes a product-neutral taxonomy. Reviewed route changes bind the plan and taxonomy hash.

```yaml
---
lervo:
  decision:
    taxonomy: decisions.default
    route: execution.providers
---
```

The taxonomy and route must exist. Invalid or stale metadata blocks planning.

## 5. Structural compilation

`lervo.structural@1` is deterministic, bounded, read-only, and tool-free. It produces generated indexes and bounded pages; two-hex-sharded bundle, concept, claim, relation, lineage, and bridge sidecars; one compact current inventory, source-unit summary, and impact projection; and a generation manifest binding tracked paths and hashes. Historical full source-unit projections are not retained. It claims only organization and provenance with `unreviewed` assurance.

Inventory displays the structural publication-input snapshot, excluding revision metadata, verification, events, and local-only agent surfaces. Query and normalization may use broader snapshots without making publication stale. Only manifest validation, lint, and the current migration plan determine currency.

## 6. Entrypoints

Initialization invents no root documents. Before structural publication, canonical instruction bootstrap inspects exact AGENTS and CLAUDE bytes. If AGENTS is absent and CLAUDE is a safe shared candidate, one exact-approved stage creates AGENTS from unchanged CLAUDE bytes plus a separate managed route; CLAUDE stays unchanged. Provider imports or managed blocks make adoption unresolved. Otherwise, first migration creates short English README and AGENTS only when missing. Existing entrypoints remain user-owned until dedicated review.

`knowledge instruction bridge --provider claude` accepts AGENTS only from a bounded instruction or structural hash. An adopted exact duplicate may become the approved thin bridge; mixed user content keeps its bytes around one managed import. Structural migration never translates existing bytes.

An active continuation document is not a permanent entrypoint. Before layout migration, a repository-wide bounded scan scores safely included Markdown using name, title, current objective, next action, blocker, state, and active-language signals. Name and location alone never establish the role. One unambiguous or explicitly selected source enters an exact-approved stage that preserves its bytes in CAS, creates `.lervo/state/workstreams/current.json`, and updates resolvable Markdown references. Only the dedicated root legacy `HANDOFF.md` is deleted during continuation migration. Every reviewed user-document deletion retires normalization lifecycle records owned by that exact source path in the same durable operation, preventing deleted sources from leaving stale formatter or lint ownership. An arbitrary continuation source may contain durable knowledge, so its user bytes remain for reviewed normalization and splitting. Multiple candidates block without merging or deletion. With no source, the working agent creates the first snapshot during its terminal turn. The structured snapshot remains outside structural publication; lasting facts belong in routed Markdown.

## 7. Bounded publication lifecycle

Navigation obeys entry and UTF-8 byte limits. New topics create files; empty categories create no paths. Refresh computes the complete desired set and deletes obsolete output only when the prior generation records its current hash. Edited or unrecorded output conflicts. Cleanup removes empty generated parents.

`.lervo/generated/manifests/current.json` records structural ownership. Refresh replaces it and deletes older valid ID-named structural manifests, but not semantic manifests or immutable review and evidence.

## 8. Semantic compilation

`knowledge compile --provider codex|claude` runs the installed provider in a temporary directory with filesystem, shell, network, external actions, tools, provider rules, and persistence disabled. The envelope contains untrusted units, exact evidence IDs, and `outputLanguage: en`.

The provider returns schema-valid concepts, claims, and within-response relations citing current versions. Results are `unreviewed`; stability or provider overlap proves neither truth nor consensus.

### Document content normalization

After canonical bootstrap, layout, and bridges are current, `migrate knowledge --provider codex|claude` uses the same boundary to return bounded Markdown candidates. Canonical adoption and bridge disposition are independent from every normalization candidate; rejecting or deferring unrelated prose cannot stale an unchanged reviewed entrypoint stage.

V1 covers ordinary `.md` files outside generated navigation and the bounded `.changes/` release-intent workspace, and distinguishes README, agent instruction, bridge, portable skill or reference, decision, product, architecture, specification, roadmap, instruction, and general profiles. Release intent and the replace-in-place current release-note projection retain their release owner and never enter provider normalization. Output follows `publication.language`; v1 accepts `en`.

Every input retains an output at its path. Ordinary splits use a sibling directory named for the source stem. The root README never splits into a root-level `README/` tree because durable detail belongs in the repository's semantic documentation hierarchy. Durable historical continuation documents may use the bounded handoff profile based on content structure regardless of name or location; the selected active source has already entered the workstream stage. Outputs have one H1 and obey byte and line limits; bridges stay below 2 KiB and 40 lines.

Coverage maps every source section to one or more declared outputs using complete, document-local integer indexes resolved to content-bound versions. Validation preserves path-scope frontmatter, lifecycle metadata such as `Status:` and `As of:`, managed blocks, provider imports, Agent Skill `name`, fenced examples and links in skills and instructions, and portable inline coordinates. Outputs end with exactly one newline; newly introduced trailing spaces, tabs, or blank lines are rejected. Exact source lines may retain required trailing whitespace only through protected material. Root README routes agents to `AGENTS.md`; wiki links become portable Markdown. Skill descriptions may be localized without changing identity. Canonical instruction frontmatter stays exact. Further condensation requires exact human review. Skill resource hashes bind lifecycle and approval; scripts and assets are not rewritten.

Candidates and shard responses remain ignored local state. Cache identity binds the envelope and compiler build. Plans bind exact candidate bytes and require per-source approval. Apply never reruns the provider: it writes candidates and sharded lifecycle records through the journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

Records bind output hashes and a user-region hash excluding managed blocks, preventing managed route refresh from staling unchanged prose. Replacement removes older active records. Apply lint permits only the expected stale instruction-bridge transition warning; immediate bridge and structural refresh restore validity. Other lint errors roll back. Later user-region, output, or resource mismatches become stale and require review.

## 9. Reconciliation and review

Reconciliation yields create, register-existing, add-relation, managed-block patch, conflict, or skip. Duplicate or contradiction resolution requires policy authorization and an exact hash. Human review is an immutable local CAS artifact. Events retain bounded IDs, hashes, counts, policy coordinates, and decision metadata. User-byte patches require separate exact output-hash approval and never enter `accept-all-safe`.

### Development-pattern lifecycle

`knowledge pattern propose` binds at least two independently grouped current source units, exceptions, invariants, reasons, verification, and one responsibility-owned target. Provider identity is observation metadata; equivalent Codex and Claude proposals converge without increasing assurance.

Candidates move through `observed -> candidate -> reviewed -> promoted|rejected|deferred -> superseded`. Exact-hash review and separate promotion bind target hashes, verification, and both agent routes. Promotion creates a missing target or accepts identical bytes; different existing bytes block. Non-check targets extend only the managed AGENTS route consumed by Claude's import.

Candidate and review bodies are immutable CAS artifacts; bounded events rebuild current state. Changed source makes unpromoted work stale and blocks apply, but never rewrites a promoted canonical target.

## 10. Durable materialization

Validate the plan, stage outputs, back up originals, publish exact bytes and deletions, lint, record the event, and clean the transaction. Pre-event failure restores originals; post-event cleanup failure preserves outputs and requires recovery.

## 11. Concepts, claims, and relations

Knowledge query ranks direct concepts lexically and may derive a separate reviewed relation projection for managed context. The projection follows exactly one current human-reviewed relation from a direct concept, examines at most 64 edges, returns at most five distinct targets, and permits at most two graph selections. Each target path must resolve to one concept and one registered document. Its current bytes are hashed at query time and bound to the source snapshot and impact report; concept records do not pretend to store a document content hash. Exact concept and relation sidecar set hashes make the projection rebuildable, while graph coordinates remain outside search-engine scoring and index identity.

Concept sidecars record title, language, type, path, ownership, lifecycle, source versions, assurance, and freshness. Bundle sidecars record language. Claims cite evidence versions. Relations include `depends_on`, `constrains`, `related_to`, `supersedes`, and `contradicts`. Markdown and sidecars are canonical; graph and lexical indexes are rebuildable.

## 12. Impact and query

Impact compares stored and current versions and marks subjects `current`, `stale`, or `unknown`. Query results are `recommended`; later evidence is required for selection, loading, injection, reference, or use.

## 13. Agent surfaces

Recognized surfaces include AGENTS hierarchy; Claude memory, rules, skills, commands, agents, and settings; Codex rules, hooks, configuration, and custom agents; Agent Skills; and supported third-party entrypoints.

Behavioral instructions, portable skills, and reviewable workflows may be semantic sources. Execution policy, hooks, client and tool configuration, provider subagents, local memory, and unknown `.agents/**` remain inventory-only. Migration may merge only versioned Lervo terminal handlers into project arrays after exact approval. Existing provider semantics are not translated. `.agents/rules/**` is not standard. See [ADR-0189](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md).

## 14. Exchange

OKF v0.2 export creates a content-addressed, schema-versioned bundle. Import preserves unknown metadata and original bundle bytes but maps external verification to local `unreviewed`. Hub document sharing uses structured shared-context coordinates plus CAS bytes; repository knowledge exchange uses OKF rather than an opaque upload. Capability packages use their separate kind-tagged envelope. A clone or another installation can lint, query, and re-export without a Hub.

## 15. Failure meaning

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

## References

- [Repository knowledge decision](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [OKF exchange decision](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md)
- [Instruction bridge decision](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
- [Agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Language-aware bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Repository-scoped decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md)
- [Reviewed document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Fail-closed provider terminal integration](../decisions/execution/providers/0196-fail-closed-provider-terminal-integration.md)
