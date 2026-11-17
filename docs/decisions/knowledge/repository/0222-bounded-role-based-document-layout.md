# ADR-0222: Bounded role-based document layout and rewrite ownership

- Status: accepted
- Decision date: 2026-08-26

Amended by: [ADR-0533](canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). Pattern-specific intake and command behavior is retired; shared contracts remain. [ADR-0547](layout/0547-block-only-layout-overflow-a-write-creates-or-grows.md). Only overflow a write creates or grows blocks it; existing overflow stays a lint error. [ADR-0583](layout/0583-hold-moves-that-overfill-a-directory-and-report-existing-overflow.md). A move or create into an over-limit directory also blocks; untouched overflow is a non-blocking advisory and a lint warning, and layout migration holds moves that would overfill a directory.

## Context

Lervo requires bounded growth and retention for every repository-authored collection. Existing controls bound profile-specific file sizes, normalization outputs to 12 per source, and decision-leaf capacity, but no single projected-capacity evaluation covers every document-bearing directory. Independently migrated bounded documents can therefore accumulate without bound in an ordinary route.

Some lifecycle decisions depend on root filenames. Provider entrypoints such as `AGENTS.md` and `CLAUDE.md` have externally defined path semantics, but public overviews, continuation sources, product documents, and migration exclusions are repository roles rather than universal root filenames. Combining these categories in repository-knowledge core makes arbitrary layouts exceptional and lets new commands omit a structural invariant.

Document bytes can also be rewritten outside Lervo. The repository wrapper excludes active normalization outputs from its formatter, but direct formatter commands, editor saves, autofix linters, Markdown transforms, and documentation generators share no ownership contract. Tool-specific exceptions cannot establish byte ownership.

## Decision

### One projected document-layout evaluator

Introduce one pure domain evaluator for the final document tree. It receives the current included-document snapshot, tracked policy, ownership and role coordinates, and proposed creates, moves, updates, and deletions. Without reading the filesystem, invoking providers, or mutating state, it returns a bounded projected layout or typed blockers.

Every repository-document authoring path must call it: initialization, repository-layout migration, document normalization, document structure operations, entrypoint bootstrap, public-document improvement, managed instruction routes, development-pattern promotion, generated publication refresh, and all future document writers. Lint calls it without proposed operations. Apply recomputes it from current bytes immediately before mutation. Commands may not duplicate or weaken its capacity rules.

The evaluator issues a `DocumentLayoutPermit` binding its version, complete proposed Markdown and MDX operation set, current document snapshot, policy hash, role-registry hash, projected counts, and expiration. The common durable-apply boundary rejects every repository-document create, update, move, or delete without that exact permit. Direct user and external-tool filesystem changes remain outside Lervo authority; lint observes their next state without retroactively claiming a permit.

Evaluate the projected after-state, not only the current scan. Moves into full directories, normalization splits, and generated refreshes must fail during planning rather than publish and depend on rollback-time lint.

### Finite capacity for every document-bearing directory

Evolve `.lervo/knowledge/document-layout.yaml` into a versioned repository-document policy with these finite defaults:

- At most 32 direct document files per directory, including the repository root.
- At most 32 direct child directories whose subtrees contain included documents.
- At most 4,096 included repository documents total.
- At most 12 outputs per normalized document family, preserving the existing bound.

The direct-directory defaults derive from a 2026-08-26 tree-only measurement of six structurally different public repositories and Lervo. It counted included Markdown and MDX paths, direct files per directory, direct document-bearing child directories, and repository totals from exact Git trees; it did not infer quality from popularity.

| Repository and measured revision | Documents | Direct-file P99 | Direct-file maximum | Child-directory maximum |
| --- | ---: | ---: | ---: | ---: |
| [Docusaurus](https://github.com/facebook/docusaurus/tree/27de99dac0ae76dd7bd2f1430dd999b328d911f7) | 1,617 | 16 | 21 | 39 |
| [Terraform](https://github.com/hashicorp/terraform/tree/8b54d8708cc34f875aa59c3163893f72bdbf498a) | 44 | 8 | 8 | 9 |
| [Kubernetes](https://github.com/kubernetes/kubernetes/tree/fbb9a10c7a0469a6f076873289e18bd680402c80) | 321 | 6 | 37 | 33 |
| [VS Code](https://github.com/microsoft/vscode/tree/222818cc1d871f299b909604ea267e955182d2a4) | 350 | 24 | 26 | 36 |
| [Node.js](https://github.com/nodejs/node/tree/49c87ef145e10d0b211b6bbde416f4db05811405) | 506 | 69 | 74 | 23 |
| [Rust](https://github.com/rust-lang/rust/tree/3ffb26fbf5bf232cf59e314e75ea325973f4f583) | 1,468 | 131 | 518 | 24 |
| Lervo before enforcement | 283 | 24 | 24 | 13 |

Thirty-two gives Lervo one-third growth headroom and covers ordinary authored distributions in Docusaurus and VS Code. Larger sampled maxima are append-only changelogs, command references, error-code catalogs, package fans, or skill catalogs. Raising the universal default for them would hide ordinary routes needing semantic refinement. Such trees require an explicit `archive`, `catalog`, or `generated_reference` override, capped at 1,024 direct documents and 256 document-bearing children. The repository total remains 4,096; the measured maximum is 1,617.

GitHub separately recommends at most [3,000 entries per directory and 50 levels of depth](https://docs.github.com/en/enterprise-cloud@latest/repositories/creating-and-managing-repositories/repository-limits), but this is a Git performance ceiling, not a human documentation-layout target. Docusaurus maps every folder to a category and every file to a document link in [autogenerated sidebars](https://docusaurus.io/docs/sidebar/autogenerated), supporting a lower navigation-oriented default.

Schema validation permits bounded repository overrides, but never absent, infinite, zero, or scanner-exceeding capacity. Existing repositories require a reviewed policy-upgrade plan that materializes their effective v1 behavior before v2 enforcement. Initialization writes policy only and creates no speculative document directories.

All included Markdown and MDX count, whether in `docs`, the repository root, or a package subtree. Excluded dependencies, unsafe sources, and local inventory remain outside the document snapshot rather than becoming capacity exceptions.

Canonical archive and inherited collections remain migration-stable at `docs/archive/**` and `docs/inherited/**`. Exact repository role paths with relocation policy `preserve` have the same path stability. Their documents remain included in discovery, compilation, query, and projected-capacity evaluation. The generic semantic-route classifier neither relocates them nor reinterprets preserved legacy metadata as current routing authority. Migration reference repair and provider normalization do not rewrite archive or inherited collection bytes.

User-owned and Lervo-generated trees share the cardinality evaluator. A generated projection must additionally declare a finite maximum output count, maximum depth, and replacement or pruning rule in its generator contract. Sharded machine registries retain separate finite sharding and retention contracts and are not documentation.

Reaching a limit never creates automatic date buckets, numbered overflow folders, catch-all routes, or arbitrary nested paths. Planning fails closed pending semantic route refinement, consolidation, deletion, or an explicitly reviewed finite policy change. A child directory created for a normalized source is a bounded document family and cannot recursively create another family.

### Repository roles instead of generic root-name branches

Resolve document behavior through scoped role coordinates:

```yaml
roles:
  - roleId: public_overview
    scopePath: .
    path: README.md
    cardinality: one
    relocation: preserve
    rewritePolicy: repository_tool
```

A role binds `roleId`, repository-relative `scopePath` and `path`, cardinality, lifecycle owner, relocation disposition, and rewrite policy. Paths are reviewed repository-policy data, not branches in generic classification code. Policy may permit the same role once per independently detected package scope.

Select legacy candidates through explicit role metadata or bounded content evidence. A filename may contribute evidence but cannot establish a role alone. Root vision, architecture, execution-specification, roadmap, and continuation special cases become tracked role or route definitions. The dedicated `HANDOFF.md` deletion rule becomes an exact-approved legacy alias disposition of the continuation role.

Keep exact provider entrypoint paths in provider-surface descriptors because their names and discovery behavior are external protocols. Codex may contribute `AGENTS.md`; Claude may contribute `CLAUDE.md`. Repository-knowledge core consumes provider-neutral roles such as `canonical_agent_instruction` and `provider_instruction_bridge` and cannot branch on provider or filename. Ecosystem adapters may contribute conventional roles, but plans must expose their source and may not claim provider or ecosystem discovery without evidence.

Generate missing human-facing roles only when tracked repository policy requires them. Provider-required roles follow the applicable provider descriptor. Unknown, conflicting, duplicate, or stale role coordinates block rather than fall back to a root convention.

### Rewrite capability and byte ownership

Treat every component capable of rewriting document bytes as a repository rewriter. Formatters, autofix linters, Markdown processors, documentation generators, IDE save integrations, and Lervo implement one adapter contract whose core contains no product names.

Each document lifecycle record declares one byte owner and rewrite policy:

- `repository_tool`: registered repository rewriters may own the complete file.
- `lervo_exact`: Lervo owns exact full-file bytes; registered external rewriters must exclude it.
- `reviewed_exact`: exact-approved normalized bytes remain unchanged unless a new review binds a transform.
- `managed_regions`: users or repository tools own bytes outside parser-bounded Lervo blocks.

A rewrite-tool descriptor binds its capability (`format`, `autofix`, `transform`, or `generate`), scope, observable configuration and lock hashes, inclusion and exclusion mechanism, dry-run support, and maximum managed-rule count. Descriptors are limited to 16 current tools and 256 managed rules per tool; current versions replace prior versions instead of accumulating history.

An adapter may satisfy an exact-byte policy by installing a bounded Lervo-managed ignore block in native tracked configuration or proving a content-bound dry run byte-idempotent. Managed blocks never overwrite user-owned configuration. Ignore projections have fixed entry and byte limits, compact exact paths only when an entire subtree has one owner, and regenerate from canonical lifecycle records. Unsafe configuration, unsupported negation semantics, excessive rules, missing tools, or changed configuration blocks compatibility and never produces a broad `**/*.md` exclusion.

The first managed-block insertion into existing user-owned tool configuration requires exact content-bound approval. Later refreshes may replace only the parser-identified Lervo block while binding the unchanged user-region hash. Removing the last managed rule removes only that block; an otherwise empty Lervo-created configuration may be deleted through the same durable transaction.

Direct invocations bypassing registered configuration, unobservable editor behavior, and unknown tools are `unmanaged`. Lervo makes no compatibility claim for them. Later byte changes stale the owning lifecycle and require review. Tool-specific integrations, including Prettier, remain adapters and common-contract fixtures only.

### Failure, privacy, and evidence

Use these stable local blocker codes:

| Code | Required local fields | Failure meaning |
| --- | --- | --- |
| `document_directory_file_capacity_exceeded` | directory, observed, projected, limit, operation IDs | The projected direct-file count is not permitted. |
| `document_directory_child_capacity_exceeded` | directory, observed, projected, limit, operation IDs | The projected document-bearing child count is not permitted. |
| `document_repository_capacity_exceeded` | observed, projected, limit, operation IDs | The projected included-document total is not permitted. |
| `document_layout_permit_required` | operation-set hash, document mutation count | A Lervo document writer reached durable apply without a permit. |
| `document_layout_permit_invalid` | snapshot, policy, role, operation, count, expiry hashes | The permit is stale, expired, or bound to different inputs. |
| `document_role_conflict` | scope, role ID, candidate path digests | A role is missing, duplicated, or disagrees across authorities. |
| `document_role_policy_unresolved` | policy hash, role ID, evidence digests | Current policy cannot resolve a required role. |
| `document_rewrite_ownership_conflict` | path, owner, rewriter ID, policy hash | Two current authorities could rewrite the same bytes incompatibly. |
| `document_rewrite_rule_capacity_exceeded` | rewriter ID, observed, projected, limit | A managed rewrite projection would exceed its finite contract. |
| `document_rewriter_unmanaged` | capability, scope digest, observation source | A possible rewrite is observed without a compatible registered descriptor. |

Local plans may contain repository-relative paths for review; provider envelopes and durable events may not. Reuse `knowledge.materialization.applied` with operations `upgrade_document_policy` and `reconcile_document_rewriters`. Both require project, plan, source-snapshot, policy, role-registry, permit, approval, and after-state hashes, plus bounded counts and adapter IDs. They exclude paths, document bodies, tool configuration, prompts, approver identity, and unrestricted errors. Failed plans and unmanaged observations emit no success event.

Failed planning writes nothing. Apply rechecks the same source, policy, role, tool, permit, and projected-layout hashes. Pre-event validation or persistence failure restores all repository bytes and emits no success. Success does not prove that an unobserved tool, editor, provider, or user subsequently respected the policy.

## Compatibility and delivery

Deliver in this order so no stage creates a new gap:

1. Add the pure projected evaluator, durable-apply permit gate, and common contract tests.
2. Upgrade tracked layout policy and resolve scoped roles without changing user documents.
3. Route every existing document writer and lint through the evaluator.
4. Add generic rewrite descriptors and managed configuration projections.
5. Implement tool adapters, using Prettier only as the first regression fixture.
6. Migrate active lifecycle records to explicit byte ownership.
7. Run self-migration and external-project acceptance before making v2 current.

Compatibility mode may read v1 policy and records but cannot report migration current until a v2 plan is reviewed and applied. There is no indefinite legacy bypass.

## Consequences

Every document folder and the repository-wide document set has an explicit finite bound. Commands cannot bypass it through another authoring path, and generated documentation must carry an output and pruning contract. Reviewed roles and routes drive repository structure, while provider-standard filenames remain confined to provider descriptors. Rewrite compatibility becomes capability- and ownership-based rather than formatter-specific, with explicit non-claims for unmanaged tools.
