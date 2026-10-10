# Context quality request and plan validation

Status: `active`
As of: 2026-10-09

Slice 1b of [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) implements bounded in-memory request and plan validation. The [runtime composition](runtime-preparation.md) now uses this validator alongside the narrower [observation contract](preparation-observations.md). It resolves current local-read bindings while preserving unobserved corpus and token denominators.

## Owners and authority

`@lervo/schemas` registers version-1 ingress, bindings, request, evidence, and plan shapes. `@lervo/context` owns normalization, semantic identity, exact-section validation, coverage, and plan verification. These operations are pure and perform no filesystem, provider, transport, clock, or event work. The private repository-context coordinator sequences injected binding resolution, preparation, and current-binding revalidation. It remains internal; the production application exposes `prepareRepositoryQualityContext`, which supplies local binding owners.

Ingress contains an attempt ID, project ID, task revision, private task input, and origin. Extra authority fields are rejected. The binding owner separately supplies the matching project/task revision/task digest, scope and policy digests, source snapshot, retrieval plan, resource profile, implementation builds, projected queries, and execution capabilities. Matching hashes establish consistency; they cannot establish that a caller owns authority. Hosts must supply trusted owners before wiring this coordinator to external input.

Normalization preserves intent and continuation, normalizes repository-relative paths, sorts set-valued task coordinates, and normalizes locale casing. Task JSON is bounded at 16 KiB of UTF-8. Conversation, publication, and retrieval languages remain independent. Origin and attempt IDs do not affect semantic identity. Scope, policy, task revision, source, plan, profile, implementation builds, and ordered projected queries do. Receipt-only capabilities are excluded from semantic comparison but rechecked before returning an attempt result.

## Evidence validation

Plan construction requires explicit applicability, obligations, corpus counts, retrieval disposition/result digest, sections, selected-evidence count, nullable token count, and receipt references. Complete corpus observations require known counts, discovered equal to eligible plus excluded, indexed equal to eligible, and zero unavailable sources. Completeness is a trusted owner observation, not inferred from reading files. Exclusion-reason detail and full stage execution remain with their future production owners.

At most 64 sources, obligations, and sections are accepted; selected evidence is bounded at 50. Each source is at most 131,072 bytes, and total source bytes must fit the profile's retained-byte limit. The validator checks full-source hashes, section hashes, nonempty UTF-8 byte ranges, exact rule source versions, and complete operative-clause coverage. A title, prefix, wrong source version, or evidence-only section cannot satisfy a mandatory clause. Conditions and exceptions require referenced loaded clauses. Duplicate source IDs, rule IDs, or section ranges fail validation.

Coverage separates required, resolved, and loaded clauses; lists missing rule IDs; counts unique packed evidence sources and omitted optional evidence; and totals section bytes. Byte/token overflow is incomplete preparation. Unknown token count is explicit incomplete evidence. The validator does not select sections, tokenize text, resolve rule applicability, or establish source relevance.

`ready` requires all supplied planning checks to pass. `no_evidence` additionally requires zero selected and packed evidence with complete applicability, corpus, and successful retrieval observations. Unsearched or failed retrieval is unavailable. Unresolved/conflicting rules, missing clauses, incomplete corpus, and insufficient capacity cannot become ready. Neither state proves provider delivery, use, relevance ground truth, or artifact compliance.

The semantic plan digest excludes request IDs, retrieval receipt IDs, and elapsed-time observations. Stored-plan validation recomputes the plan against the current request and exact source bytes; a self-consistent supplied hash alone is insufficient. Observation timing requires a non-null duration only when marked observed. Private requests and locators are not public telemetry and must remain within their source access scope.

## Cancellation and failure

The private coordinator applies an attempt deadline from resolution onward and the tighter resolved profile deadline. It checks cancellation and elapsed time around asynchronous boundaries and synchronous plan validation. A pending port cannot keep the caller waiting past cancellation or timeout. Ports receive an abort signal and must stop their own work; detaching a caller cannot forcibly stop an uncooperative implementation. Late results cannot become successful plans.

Bindings are resolved again before returning a plan. Changed task, scope, policy, source, retrieval, profile, implementation, or capability coordinates reject the attempt. There is no automatic retry or retained result cache. The [runtime host](runtime-preparation.md#resource-lifetime) now implements process-local admission, pending queues, in-flight sharing, aggregate reservations and provider-call charging. Schema limits alone do not implement those controls; reservations are not process-RSS measurements.

Failures return the bounded attempt ID, status, reason codes, missing-binding names when known, and `plan=null`. Cancellation returns `cancelled`; changed bindings return `stale`; other preparation failures return `unavailable`. Malformed ingress throws a fixed contract error before any port runs. Arbitrary port exception text is never returned.

| Implemented reason                                            | Meaning                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `context_binding_unavailable`                                 | Required trusted coordinates could not be resolved                 |
| `context_contract_invalid`                                    | Invalid shape, contradictory evidence, or an unmapped port failure |
| `context_rule_unresolved` / `context_rule_conflict`           | Applicability is incomplete or obligations conflict                |
| `context_corpus_incomplete` / `context_retrieval_unavailable` | Corpus completeness or successful retrieval is unavailable         |
| `context_required_section_missing`                            | Exact complete required clauses are absent                         |
| `context_capacity_insufficient`                               | Prepared bytes or observed tokens exceed the profile               |
| `context_token_count_unavailable`                             | Token capacity cannot be verified                                  |
| `context_binding_stale`                                       | A required version or current binding changed                      |
| `context_budget_exceeded`                                     | Source retention or attempt deadline exceeded its bound            |
| `context_cancelled`                                           | The caller cancelled preparation                                   |

## Current consumers and remaining acceptance

Existing observations add optional `planningReadiness`: `status=unavailable`, `reasonCode=context_binding_unavailable`, and bounded missing-binding names. Current callers report all unresolved request-planning coordinates; existing retrieval/source observations do not substitute for authority or applicability. Historical reports without this property remain readable. Terminal receipt readers may omit unsupported diagnostics while preserving the existing activation record. No new quality event writer or protocol capability is activated.

Focused cases cover semantic parity across origin kinds, independent language inputs, wrong task/scope bindings, source tampering, partial clauses, unknown versus empty observations, contradictory coverage, receipt/timing independence, cancellation, timeout, late completion, and changed capabilities. Both terminal adapters retain common preparation diagnostics and byte budgets. These are source-level fixtures, not installed surface parity or a measured speed or Hit improvement.

[Applied owner-rule preparation](applied-instructions.md) now connects one bounded applicability and full-clause path to real consumers. [Runtime preparation](runtime-preparation.md) adds structured rule/conflict resolution, exact sections, local-read bindings and process-local resource controls. The [roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md) retains complete corpus/token observations, delivery protocol migration, real-task evaluation, outcome verification, and installed rollout.
