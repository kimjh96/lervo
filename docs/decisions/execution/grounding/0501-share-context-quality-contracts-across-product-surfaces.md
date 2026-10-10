# ADR-0501: Share context quality contracts across product surfaces

Status: `accepted`
Decision date: 2026-10-09

## Context

The owner requested dependable Hit quality across Claude Code terminals, Codex terminals, Discord, and a future first-party platform, and asked for design before further implementation. Hit means a retrieval recommendation; it does not establish that an applicable rule or necessary passage reached the provider or that the resulting artifact complied with it.

Current paths share repository-context and search components but differ in orchestration. Compact terminal preparation returns no retrieved documents, agent-issued knowledge queries consume their query directly, and managed conversation composition can project queries. Applied owner-rule titles do not deliver complete obligations. Exact-hash terminal loading can deliver a document prefix that omits its relevant clause. Current managed coverage leaves relevance unavailable without reviewed ground truth. These are distinct failure opportunities, not evidence that one ranker causes every reported problem.

The preceding local English-publication instruction correction addresses one delivery gap. It does not establish general applicability resolution, multilingual relevance, installed provider compliance, or cross-surface parity.

## Decision

Adopt one headless context-quality application path, composed from existing domain owners and explicit ports. Surface adapters normalize requests and deliver projections. Provider adapters translate controlled input and observed provider evidence. Neither adapter owns policy applicability, ranking, section selection, or semantic completion.

The path resolves applicable obligations separately from ranked evidence, prepares a current authorized corpus, executes an explicitly selected retrieval plan, chooses exact source sections, and exposes delivery and artifact-verification evidence separately. Policy and evidence preserve their authority classes. Retrieved prose never acquires instruction authority through a high score.

Use the [context-quality specification](../../../specifications/execution/context-quality.md) for ownership and shared behavior, its [contracts](../../../specifications/execution/context-quality/contracts.md) for bounded records and failure meanings, and its [acceptance protocol](../../../specifications/execution/context-quality/performance-and-acceptance.md) for quality, cost, and parity.

### Meaning of parity

Equivalent normalized task, authorized scope, source and policy versions, explicit retrieval plan, projected queries, implementation builds, and resource profile must produce the same deterministic semantic result. Origin IDs, receipt-only capabilities, timings, and platform rendering are excluded from that comparison; authorization, privacy scope, and planning capacity are not. A different provider-generated query is a different input, and belongs in an end-to-end quality comparison.

All surfaces meet the same quality floor for the same task class. Provider/model behavior, available input capacity, transport overhead, and evidence capabilities remain observable dimensions. Equal quality does not claim identical generated prose, identical network time, or managed delivery from an unmanaged hook. A future UI must pass the common suite and its own installed journey; a native-chat fixture alone cannot establish installed acceptance.

### Applicability and execution

Configured obligations and reviewed rule scopes resolve independently of top-k retrieval. A bounded rule clause carries its source, version, applicability, conditions, and exceptions. Unknown applicability stays unresolved. Exploration and conversation remain open; an unresolved mandatory obligation prevents only the consequential Lervo-controlled effect or completion claim that requires it. Direct terminal hooks retain availability-safe behavior and cannot claim authority over arbitrary provider writes.

Conversation language, publication language, and retrieval language are separate inputs. A Korean request with English publication policy must preserve Korean conversation where appropriate and produce English repository prose unless an authorized explicit exception applies.

### Extension and module growth

Reuse `@lervo/context` for pure decisions, `@lervo/repository-context` for application sequencing, `@lervo/search` for retrieval contracts, and existing knowledge, delivery, writing, and verification owners. Keep provider processes, filesystems, index persistence, and transports behind adapters. Add modules by independent responsibility and new packages only when current consumers require an independently governed boundary.

No universal context manager, arbitrary pipeline DAG, provider or channel switch inside domain logic, or per-surface ranking fork is introduced. Preserve [the code convention](../../../foundation/code-convention.md): semantic split signals apply before 400 lines, and exact-content long-module review cannot waive mixed responsibilities. Architecture ratchets must check imports and forbidden concepts as well as declared package dependencies.

### Performance and rollout

Retain local execution without a Hub, exact-content preparation reuse, finite cache retention, and fresh validation before consequential use. The default compact hook gains no mandatory hidden provider turn or full-corpus scan. A missing warm index remains explicit unavailable preparation or separately scheduled work, not an unbounded prompt wait or a successful no-hit result.

Compare lexical baseline, query projection, semantic retrieval, fusion, reranking, and section selection as attributable candidates. Existing immutable activation and rollback contracts remain authoritative. Candidate registration and this design activate nothing.

Migrate one responsibility and then its consumers at a time. Adapters for terminals, Discord, and the native-chat fixture run the same semantic cases. Introduce reader-compatible records before writers, qualify exact source and builds, observe installed behavior, and preserve explicit rollback. The [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md) defines the order and completion evidence.

## Alternatives

- Increasing top-k or always loading whole documents leaves applicability, relevance, and truncation unresolved while increasing context cost.
- A universal multilingual vector index may improve candidate recall but cannot guarantee applicable policy delivery or artifact compliance; it remains a separately evaluated adapter candidate.
- Independent terminal and Discord implementations duplicate policy and make future platform parity a migration project rather than a conformance property.
- Rewriting every existing context consumer at once increases compatibility and evidence risk. Incremental extraction with paired equivalence preserves working boundaries.
- Forcing managed semantics onto direct terminals would misrepresent capabilities and violate availability-safe hooks.

## State and acceptance

The owner authorized implementation on 2026-10-09. The first [preparation-observation slice](../../../specifications/execution/context-quality/preparation-observations.md) is narrower than the planned request/plan API and does not activate quality events or establish installed acceptance.

The proposed versioned request, plan, report, two event names, bounded failure codes, privacy handling and retention are defined in the linked contracts. The [request/plan validation slice](../../../specifications/execution/context-quality/request-plan-validation.md) implements bounded pure validation and a private cancellation/revalidation coordinator. The [applied-instruction path](../../../specifications/execution/context-quality/applied-instructions.md) connects current owner-rule scope and full-clause preparation to managed discovery, terminal hooks and knowledge query. Subsequent runtime and [host outcome integration](../../../specifications/execution/context-quality/host-outcome-integration.md) implement local binding owners, task and writing observations, bounded correction and quality recording under explicitly activated writer 6. Complete corpus/token observations, reviewed quality and installed acceptance remain pending. Existing E1-E4 evidence meanings and selected, loaded, injected, referenced and unknown-use distinctions remain intact.

Design acceptance requires a complete responsibility map, bounded contracts, scoped failure dispositions, candidate evaluation protocol, cross-surface conformance matrix, and reversible migration. Runtime completion additionally requires the roadmap's implementation and installed evidence. Public release, external services, paid evaluations, and the future platform UI remain separate effects.

## References

- [ADR-0455 platform adapter boundaries](../applications/0455-ratchet-the-platform-adapter-boundary-on-neutral-seams.md).
- [ADR-0459 context measurement](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md).
- [ADR-0306 retrieval composition](../../search/engines/0306-separate-search-engine-replacement-and-composition.md).
- [ADR-0327 unmanaged availability](../providers/hooks/0327-availability-safe-unmanaged-terminal-hooks.md).
- [Managed context coverage](../../../roadmap/context-grounding-coverage.md).

## Runtime implementation update

The owner authorized remaining-work items 1–5 on 2026-10-09. [Shared runtime preparation](../../../specifications/execution/context-quality/runtime-preparation.md) records the source implementation and its narrower evidence boundaries. Current local-read bindings, structured applicability, exact passage preparation, process-local resource admission, and task/language projection are connected to existing consumers. Full ready/no-evidence claims still require observed corpus and token denominators; managed delivery, artifact verification, event-writer migration, broad reviewed acceptance, and installed rollout retain their separate contracts.
