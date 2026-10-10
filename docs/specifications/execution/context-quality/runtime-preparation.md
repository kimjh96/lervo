# Shared runtime context preparation

Status: `implemented`
As of: 2026-10-09

This source implementation covers the owner's remaining-work items 1–5: runtime composition, structured applicability, exact sections, bounded preparation resources, and local task/language projection. These item numbers differ from the earlier delivery-slice table. Artifact verification, new event writers, broad reviewed quality/performance acceptance, and installed rollout remain separate work under [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md).

## Runtime ownership and bindings

`@lervo/repository-context` composes the existing request/plan validator through `prepareRepositoryQualityContext`. Direct knowledge query, both terminal modes, managed search, and conversation search invoke it. The native-chat fixture uses the same repository composition. The CLI's old managed-search implementation is now a compatibility facade.

The application reads the current project manifest, local knowledge policy, native instruction paths, and generated owner-rule catalog. Its read-scope digest includes canonical local root identity, manifest content and target paths. The policy digest binds policy content and exact instruction versions. Requests bind normalized task content, the observed retrieval generation and build identifier, projected queries, and a versioned resource profile. The core/projector build identifiers identify versioned implementations; they are not installed release attestations. Revalidation rereads policy, catalog membership, rules and selected candidate bytes before returning a plan. Unknown or changed bindings produce bounded failure codes without raw source/error text.

This is authority to prepare current local repository context. It grants no repository write, external effect or provider permission. All delivery/effect capabilities in this read-only composition remain false. Existing managed E1–E3 and consequential-effect gates retain their owners; a preparation plan cannot bypass them.

The returned local result contains the plan or a failure, exact evidence passages, and the owner-rule preparation report. Direct query exposes these in JSON and renders the clauses and passages in text. Terminal context exposes the prepared text; richer plans remain local application results. Managed consumers continue to deliver whole source documents through their existing exact-byte pipeline. Their preparation plans are not replacement delivery receipts.

Corpus completeness and provider token counts remain unobserved in these adapters. Ready/no-evidence cannot be inferred from a nonempty hit list, a bounded candidate list, or an empty result. Native instructions loaded independently by a provider remain missing from this preparation's loaded-clause denominator unless their bodies were prepared here. Accordingly, an ordinary successful local preparation can correctly remain `incomplete`; compact mode with no retrieval remains unavailable for a full evidence plan. The narrower owner-rule report can independently be complete.

## Structured instruction applicability

Canonical instruction frontmatter may add this versioned descriptor alongside existing `paths`:

```yaml
lervo:
  contextScope:
    schemaVersion: 1
    when:
      paths: ["docs/**"]
      artifactKinds: [markdown]
      requestedActions: [repository.write]
    except:
      - artifactKinds: [quotation]
    decision:
      key: publication_language
      value: en
```

`when` conjoins dimensions; values within a dimension are alternatives. `except` is a bounded list of alternative selectors using the same dimensions. A selector can also bind `taskDigests` to exact normalized task content. Missing task/artifact/action coordinates are unknown, not negative evidence. A definite nonmatch excludes the rule; an unknown required coordinate or exception leaves it unresolved. Changing target paths changes task and scope bindings and reruns applicability. Retrieval keywords never supply authority or infer requested actions. Direct query accepts repeated `--path`, `--artifact`, and `--action` flags for these explicit task coordinates, plus `--continuation` for retrieval context; these flags grant no execution permission.

`supersedes` may name exact generated owner-rule IDs at the same authority level. Missing references remain unresolved; cycles among applicable rules conflict. Applicable acyclic replacements exclude their named predecessors. Transitive replacement requires every intermediate rule to be applicable and resolved before exclusions begin. An inactive, unresolved or conflicting intermediate rule cannot suppress another rule. The eligible replacement set is fixed before exclusions, so input ordering does not change a valid chain. The local repository preparation build is version 2, distinguishing this correction from earlier plan bindings. Native instructions cannot use this field to suppress owner rules. Conflicting retained `decision` values for one key preserve both clauses and mark conflict. This resolves declared metadata, not arbitrary contradictions inferred from prose. Unsupported metadata fails closed. Managed discovery refuses unresolved structured conditions or conflicts; unmanaged preparation preserves the complete clauses with explicit limitation diagnostics.

The existing bounds remain: at most 64 rules, 64 paths, 32 action/artifact labels, 16 exception selectors, and 8 KiB frontmatter. Whole rule bodies include their original conditions and exceptions. Packing returns explicit prepared-path identities; source text cannot forge another rule's loaded status by containing a marker string.

## Exact evidence sections

The domain selector parses Markdown structure, so fenced-code headings are not section boundaries. It retains the preamble, selected heading bodies and descendants, ancestor introductions, definition/condition/exception sections, explicit conditional paragraphs, and Markdown link definitions. It packs complete source ranges or reports omission. This conservative structural strategy is not a semantic proof that every implicit prose dependency has been resolved. Canonical instruction bodies always remain whole.

Each range carries full-source hash, byte start/end and section hash. Strict UTF-8 decoding preserves the BOM and multibyte offsets. Changed source hashes, invalid bytes, oversized sources and insufficient capacity cannot produce a truncated successful passage. A relevant clause at the end of a long document can be selected without its unrelated middle sections.

Knowledge query and retrieval-mode terminal assembly use these passages. Terminal wrappers and existing 28 KiB/4 KiB envelopes remain bounded. A passage that cannot fit produces an omission notice. Managed full-document delivery remains a complete superset, not a prefix. Legacy terminal receipts understand only full/prefix documents: section-only passages are not misreported as either. Their legacy loading observation stays unobserved; new section receipt writers belong to the separate protocol rollout.

## Resource lifetime

One process-local host admits expensive retrieval stages and exact preparation. It permits two active jobs, at most 32 pending jobs, at most 32 waiters on one semantic job, and a 64 MiB aggregate reservation budget. Each application stage reserves 16 MiB; memory admission can reject before the pending-count ceiling. Reservations account for admission, not a measured process-RSS ceiling. Existing retrieval index/cache owners retain their own allocation and eviction policies.

Exact preparation shares in-flight immutable results only for matching canonical root, normalized task, source generation, candidate hashes, projected queries/builds, plan, capacities and deadline class. Each waiter receives its own attempt identity and detached result. Retrieval whose fresh generation is not yet known uses separate admission rather than reusing a task result; existing exact-generation computational caches continue to own index reuse.

Waiter deadlines include queue time. One cancellation detaches only that waiter. The final waiter aborts underlying work; its slot/reservation remains until non-cooperative work actually settles. Queue or byte overflow returns `context_budget_exceeded`; cancellation returns `context_cancelled`. A late result cannot become current. Final-reader retirement eagerly evicts the result, so no completed per-task cache or predecessor generation is retained. The host is process-local, not a cross-process machine scheduler.

The local preparation deadline is three seconds; on-demand/managed retrieval admission defaults to thirty seconds, and terminal retrieval uses three seconds. Provider budget is zero. The budget port checks and charges an optional call before execution; these implementations never invoke a provider. This host does not replace budgets for existing separately owned provider query projection.

## Task/language projection and evidence

The versioned local projector retains identifiers and target paths, includes bounded continuation context for short requests, and adds a small general Korean-to-English retrieval vocabulary. Publication language does not set conversation language or authority. An explicitly Korean-only retrieval request does not add English aliases. Output remains at most 500 characters, with a 16 KiB input ceiling and the existing 32-word primary-task bound. No additional provider call or new search engine is introduced.

Managed and direct query paths use the local projection. Conversation search supplies its current workstream objective as retrieval-only continuation. Retrieval-mode terminal search retains its existing validated projector and exact selected retrieval-plan binding; it does not silently substitute the local projector. Compact mode still performs no retrieval or provider projection.

Authored conformance cases compare unchanged Lexical v2 with and without local expansion on six Korean/English task pairs. They cover performance, search, cache recovery, instructions, concurrency/cancellation and release. Additional cases cover identifiers, paths and short continuations. These are deterministic implementation checks, not human-reviewed relevance labels or an overall quality-uplift benchmark. No evidence currently justifies replacing the engine or adding a provider reranker in this scope. Broader ablation and real-task acceptance remain in [the evaluation protocol](performance-and-acceptance.md).

## Verification boundary

Focused contracts cover semantic origin parity, stale source rejection, changed task scope, complete exception loading, conflicting rules, late-tail selection, UTF-8 byte integrity, queue pressure, cancellation isolation, provider-call budgets and resource retirement. Existing provider, terminal, managed and conversation regressions remain required. Source verification does not establish installed behavior, artifact compliance, a process-memory peak, or production retrieval/performance improvement.
