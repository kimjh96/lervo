# Context quality across product surfaces

Status: `proposed`
As of: 2026-10-09

This design makes applicable obligations, relevant evidence, exact delivery and verified outcomes consistent across direct provider terminals, managed execution, Discord and future product hosts. [ADR-0501](../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) records the accepted architecture decision. The [preparation-observation slice](context-quality/preparation-observations.md), [request/plan validation](context-quality/request-plan-validation.md) and [shared runtime preparation](context-quality/runtime-preparation.md) are implemented in source. [Host outcome integration](context-quality/host-outcome-integration.md) also connects task and writing observations, bounded correction and optional quality recording. Complete corpus/token observation, reviewed quality, recording-resource qualification and installed acceptance remain pending.

## Contract topics

- [Requests, plans, evidence, and failure contracts](context-quality/contracts.md).
- [Performance, evaluation, and cross-surface acceptance](context-quality/performance-and-acceptance.md).
- [Staged delivery and completion criteria](../../roadmap/natural-language-grounding-quality/context-quality-parity.md).

- [Implemented preparation observations and their limits](context-quality/preparation-observations.md).
- [Applied owner rules in managed, terminal, and query paths](context-quality/applied-instructions.md).

## Common application flow

Native input is normalized into a task and an independently resolved authority scope. The application resolves applicable rules, observes the eligible corpus, obtains any planned query projection, retrieves evidence, assembles exact sections, and returns a bounded plan. Delivery and result verification follow through their existing owners. A read-only plan grants no repository-write, provider-call, export, or publication authority.

Surface identity is provenance, not a ranking feature. Provider identity is an adapter coordinate and, where provider query generation is selected, a measured projection input. Neither may choose a weaker policy or a different unreported search engine.

| Responsibility                                                             | Existing owner to extend                                              | Boundary                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Rule applicability, obligation coverage, evidence packing decisions        | `@lervo/context`                                                      | Pure typed inputs and outputs; no provider, transport, filesystem, or event writes |
| Current sources, reviewed instruction scopes, provenance, section locators | `@lervo/repository-knowledge`                                         | Canonical ownership and source validation; no surface or provider policy           |
| Engine, projection, fusion, and rerank contracts                           | `@lervo/search`                                                       | Candidate identities and stage validation; concrete engines remain adapters        |
| Plan execution and cancellation                                            | `@lervo/repository-context`                                           | Sequence domain decisions and injected ports; no copied ranker or rule logic       |
| Exact provider input and delivery observations                             | `@lervo/context-delivery` and provider adapters                       | Preserve E1-E3 contracts and declared evidence capabilities                        |
| Artifact language and task verification                                    | Existing writing and verification packages                            | Bind verdicts to artifact and policy hashes; no context selection or transport     |
| Evidence projection                                                        | `@lervo/context-coverage`                                             | Rebuild reports from observed records; never infer use or relevance                |
| Command and host transport                                                 | CLI, Node composition, application-contract and product-host adapters | Normalize, authorize, invoke, and render the shared application result             |
| Native surface input and output                                            | Terminal, Discord, native-chat, future host adapters                  | Native coordinates and limits only; no policy, search, or completion authority     |

These are responsibility allocations, not instructions to add exports to every package or to create one new package per row. Persisted or public wire shapes use the existing schemas and event-contract owners. Private types remain with their implementations. External products consume a future negotiated product-host capability, never workspace-private imports or a second knowledge store.

## Applicable obligations

Separate configured global obligations, reviewed scoped rules, and task evidence. Resolve path, artifact-kind, and action scopes through a versioned rule descriptor linked to canonical clauses. Rule scopes, precedence, conditions, and exceptions are reviewable source data, not aliases embedded in a ranker. Unreviewed generated text and retrieved external content cannot become obligations.

Use current target paths and task intent, not request keywords, to evaluate explicit scope predicates. Preserve applicable provider-native instruction hierarchies; repository metadata cannot override higher-authority instructions. An authorized explicit user exception binds a rule and task scope and cannot be inferred from the conversation language. Unresolved equal-authority conflicts retain both source coordinates and stop only the affected controlled effect or verified-completion claim.

Before a target set, artifact kind, or action changes, resolve obligations again. The initial conversational request need not enumerate all future paths. Registering a rule is not evidence that its clause was loaded. For a long rule, deliver its complete operative clause with its conditions and exceptions; a title or lossy summary cannot satisfy obligation coverage.

Global obligations can be prepared at prompt intake from a current bounded policy projection. Task-scoped preparation runs when the agent declares targets through the common application operation or a supported native tool boundary observes them. Managed orchestration rechecks targets before controlled effects. A direct provider without such a boundary reports target coverage as unobserved and may verify observable changed artifacts afterward; a prompt-only hook cannot prove advance coverage of undeclared paths. Adapter capability tests must establish which boundary actually exists.

## Retrieval and source scope

Conversation locale, publication locale, and corpus/query languages are independent. Query projection preserves exact identifiers and paths and separates independent evidence roles. Native adapters do not author semantic expansions. Use the existing task interpretation where possible; a separately invoked model projector must have an explicit plan, usage observation, and bounded lifecycle.

Sources are restricted by current authority and privacy before ranking. Eligible source classes can include canonical documents and task-relevant code or verification evidence through existing typed corpus ports. Inventory-only or secret sources do not become retrievable by a high score. The source adapter reports exclusions and coverage failures without leaking forbidden paths or content.

Distinguish content identity from semantic validity. A fresh hash does not prove an old design is still authoritative. Reviewed supersession and scoped historical status govern current-design answers; historical questions may legitimately retrieve earlier sources with their status intact. Do not add manual per-query routes or assume that every recent document supersedes every older one.

Retain the selected plan's bounded retrieve, optional fusion, and optional rerank stages. Reranking cannot supply a missing source. Relations may contribute only through the existing reviewed, current, bounded relation contract, not unbounded graph expansion. Optional semantic adapters require independent data-export, installation, runtime, and cost contracts.

## Evidence assembly and revalidation

Rank documents for candidate discovery, then choose relevant source sections. Each section binds its source hash and byte range plus a human-readable locator. Preserve necessary headings, conditions, exceptions, and adjacent definitions. Deduplicate repeated evidence while retaining distinct provenance and contradictory sources needed to resolve the task.

Allocate capacity to resolved mandatory obligations before optional evidence. If required clauses exceed the profile, return insufficient capacity and the missing obligation identifiers. A larger negotiated profile or staged loading may resolve it; silent truncation cannot. A provider-visible path alone is a pointer, not delivered body evidence.

Validate exact sources at loading and again at a consequential boundary when the source, policy, task, or plan changed. Full-document hashes remain authoritative even for section delivery. Limit reselection to the named request budget; continuous edits terminate with stale-input status rather than looping indefinitely. Result verification rechecks the latest artifact hash; a verdict on a previous draft cannot complete the new one.

## Execution capability and surface capability

Execution mode and surface are separate axes. Discord can initiate a managed run or native repository work; a terminal can submit a managed command or remain an unmanaged provider session. First-party presentation does not imply controlled provider input. Each request declares observed capabilities rather than deriving them from a channel name.

Managed delivery uses existing exact-envelope acknowledgement. Unmanaged hooks report prepared context and any verifiable references, with injection unobserved and use unknown when that is all they can establish. Neither adapter acknowledgements nor output citations prove internal attention. Outcome verification observes artifact compliance separately.

The same semantic plan may have different rendering, pointer transport, and receipt types. Message-size limits apply to presentation, not to the provider evidence budget. Discord attachments or a future detail panel may expose the same report without changing its meaning. Unsupported capabilities return explicit states rather than fabricated parity.

## Composition and growth controls

Extend existing modules only while they keep one primary reason to change. Separate applicability, corpus observation, stage execution, section packing, evidence recording, report projection, and artifact verification. The application composes these operations; it does not own their policy. Inject clocks, cancellation, storage, and external ports at the composition boundary.

Keep terminal hook, Discord responder, and future product-host entrypoints thin. Adding a surface must require adapter wiring, rendering, and conformance tests, not edits to core ranking or applicability. Adding an engine must require its adapter, descriptor, contract tests, evaluation, and explicit activation, not surface branches. Do not build a general plugin framework or arbitrary workflow graph for this feature.

Apply the existing structural checklist to every touched source file. At two semantic split signals, split in that slice or record the exact bounded follow-up and verification when separation materially raises delivery risk. A file below 400 lines can still violate responsibility boundaries; a refreshed long-module hash cannot waive them.

## Runtime adoption through owner items 1–5

[Shared runtime preparation](context-quality/runtime-preparation.md) documents the implemented local read-scope composition, structured rule conditions, exact sections, process-local admission and task/language projection. It preserves unknown corpus/token observations and separate managed delivery evidence. The subsequent outcome and host slices add source-level verification and event recording; reviewed broad acceptance and installed rollout remain open.

The [outcome and event rollout slice](context-quality/outcome-and-event-rollout.md) adds read-only artifact observations, explicit query recording, version-6 readers and activation support, and a bounded diagnostic performance protocol. Production acceptance and installed rollout remain separate.
