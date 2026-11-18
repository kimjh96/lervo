# Context quality requests and evidence contracts

Status: `proposed`
As of: 2026-10-09

These version-1 shapes define the behavior proposed by [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md). The [request/plan validation slice](request-plan-validation.md) implements a bounded in-memory subset. The [outcome/event slice](outcome-and-event-rollout.md) implements read-only publication observations, explicit query recording, and version-6 event compatibility. Full application adoption and production acceptance remain open; the implementation page distinguishes callable validation from future contracts. Event allowlists, compatibility readers, and common contracts must precede writer activation.

## Request and identity

`ContextQualityRequestV1` requires `schemaVersion`, `requestId`, `projectId`, `taskRevision`, `taskDigest`, `scopeDigest`, `policySetDigest`, `sourceSnapshotId`, `retrievalPlanId`, `profileId`, `executionCapabilities`, and `origin`. Its private task input contains intent, current target paths, artifact kinds, requested actions, bounded relevant continuation, conversation locale, publication locale, and retrieval languages. Every list and text field is schema-bounded. Ingress adapters supply task input and correlation; the application resolves trusted scope, policy, source, and plan coordinates before constructing this normalized request. A failure before normalization still retains its attempt ID and explicit unavailable outcome.

`origin` carries only channel kind, adapter build, and opaque correlation identifiers. `executionCapabilities` declares controlled provider input, exact delivery acknowledgement, observed artifact access, and Lervo-controlled consequential effects independently. An authorization owner resolves `scopeDigest` from current grants; callers cannot widen scope by supplying different text or a self-asserted capability. These capabilities report mechanisms and do not grant authority.

`semanticInputDigest` binds normalized task, scope, source, rule and exception versions, selected plan and adapter builds, profile, projected queries, and planning-relevant capacity constraints. It excludes transport origin IDs, wall-clock timing, rendering, and receipt-only capabilities such as whether injection acknowledgement can be observed. Identical semantic inputs produce identical deterministic plan outputs; managed and unmanaged consumers can therefore compare their selected content without pretending their receipt capabilities match. Requests with different authorization or privacy scopes never share result-cache identity.

Request IDs identify attempts; semantic digests identify comparable inputs. An identical retry can reuse immutable preparation within its valid scope but cannot reuse delivery acknowledgement or a verdict for another provider turn or artifact version.

## Operation boundaries

The shared application exposes three conceptual operations through existing composition owners:

| Operation                | Required input                                                                  | Output and authority                                                                 |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `prepareContext`         | Validated request, source/rule observations, selected ports                     | Immutable `ContextQualityPlanV1`; no repository or publication authority             |
| `observeContextDelivery` | Plan digest, exact provider turn, supported native receipt                      | Existing delivery evidence or preparation-only observation; no inferred provider use |
| `evaluateContextOutcome` | Plan digest, exact artifact digest, verification definition and evaluator build | Version-bound verification observation; completion remains with its existing owner   |

These are application operations, not three new network services. A future host boundary must advertise availability and schemas explicitly; [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the product-host protocol.

## Plan contents

`ContextQualityPlanV1` requires `schemaVersion`, `planDigest`, `semanticInputDigest`, `status`, `reasonCodes`, `obligations`, `corpusCoverage`, `retrievalReceiptRefs`, `sections`, `coverage`, and `costObservation`. Arrays have the limits below and never truncate required records without an incomplete result.

`planDigest` covers the canonical semantic projection: input digest, status/reasons, obligations, coverage, source sections, and stage result/build/configuration digests. It excludes elapsed time, usage, origin, and attempt-specific receipt IDs. The complete observation has a separate artifact hash. This prevents timing or native receipt differences from breaking semantic parity while retaining exact audit evidence.

| Record           | Required fields and meaning                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obligation       | `ruleId`, source hash, clause locator, authority class, scope digest, applicability disposition, condition/exception references, required verification definition or explicit `not_automatable` |
| Corpus coverage  | Snapshot and scope digests, discovered/eligible/indexed/excluded/unavailable counts, completeness, exclusion counts by stable reason, bounded private detail reference when permitted           |
| Retrieval stage  | Stage, adapter/build/configuration identity, input/result digest, requested/returned limits, disposition, elapsed time and observed usage reference; use existing stage receipts                |
| Section          | Source ID, full-source hash, UTF-8 byte range, locator, section hash, role `obligation` or `evidence`, required flag, associated rule or evidence-role IDs                                      |
| Coverage         | Required/resolved/loaded clause counts, missing IDs, selected and packed evidence counts, delivered-byte budget, omitted optional-evidence count                                                |
| Cost observation | Stage timing and observed resource/usage coordinates; unavailable dimensions remain nullable with a reason                                                                                      |

All counts refer to unique source or clause versions. A complete file scan does not imply complete corpus registration or complete relevance. Coverage records must identify the denominator and distinguish policy exclusions from unavailable eligible inputs. Source-level details stay private and may be paginated; the bounded summary must not turn omitted details into complete coverage.

## States and failure meaning

Plan `status` is one of `ready`, `no_evidence`, `incomplete`, `unavailable`, `stale`, or `cancelled`. `ready` means required planning and source checks passed, not that retrieval is complete ground truth or a provider complied. `no_evidence` requires successful applicable-rule resolution and complete eligible-corpus search with no relevant admitted evidence; it proves no absence outside that scope. A query not run cannot produce this state.

Obligation disposition is `applicable`, `not_applicable`, `unresolved`, or `conflict`. Each requires a bounded reason and exact source coordinates. The last two make an affected mandatory plan incomplete. Delivery keeps existing selected, loaded, injected, and referenced states; `prepared` remains the unmanaged observation and internal use remains unknown. Outcome disposition is `passed`, `failed`, `unavailable`, or `not_applicable`, bound to a verification definition and artifact version.

| Proposed reason code               | Meaning and recovery                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `context_rule_unresolved`          | Required scope or exception cannot be established; resolve current rule/task data                          |
| `context_rule_conflict`            | Applicable equal-authority obligations conflict; preserve both and resolve the bounded conflict            |
| `context_corpus_incomplete`        | An eligible source or registration observation is unavailable; repair or reobserve before an absence claim |
| `context_projection_unavailable`   | Selected query-projection stage failed or was not available; no silent plan substitution                   |
| `context_retrieval_unavailable`    | A required retrieve, fusion, or rerank stage failed; retain its stage failure reference                    |
| `context_required_section_missing` | Required clause failed loading or complete assembly; reload exact current source                           |
| `context_capacity_insufficient`    | Required clauses exceed the negotiated profile; request a supported profile or staged delivery             |
| `context_binding_stale`            | Task, source, scope, rule, plan, or artifact binding changed; reprepare within the retry bound             |
| `context_budget_exceeded`          | This preparation exceeded its declared work/deadline budget; stop the stage, retain incomplete evidence    |
| `context_capability_unsupported`   | The requested delivery or verification mechanism is not supported; retain narrower truthful evidence       |
| `context_verification_failed`      | An observed artifact violates the bound verification definition; correct only authorized bytes             |
| `context_verification_unavailable` | Verification did not produce a valid observation; do not equate this with pass or failure                  |

Cancellation has status `cancelled` with its request coordinate and no successful-result promotion. These codes are local to this proposed contract; native and historical errors are mapped by adapters without unrestricted error text. Managed effects requiring complete obligations cannot pass with missing evidence. Unmanaged hook failures retain availability-safe behavior and report the limitation when observable. No failure prohibits unrelated conversation, memory, or read-only investigation.

## Bounds and lifetime

The initial proposed ceiling is 64 target paths, 64 applicable obligations, 64 packed sections, 50 final retrieval candidates, and 32 distinct reason codes per report. Text fields use existing identifier/path limits; the private task text budget is 16 KiB. More work requires a task partition or supported larger versioned profile, not silent truncation. Candidate stages retain the existing plan's tighter query, stage, and relation bounds.

Compact prompts keep their 4,096-byte hard envelope. Additional exact sections require an observable read/delivery operation rather than overflow. Other profiles declare explicit byte/token, time, concurrent-preparation, and optional provider-call limits before execution; unsupported or missing profiles fail validation. These values are capacity ceilings, not instructions to fill quotas. Changing a ceiling changes the profile digest and requires benchmark review.

One active preparation per semantic key shares immutable work within a host. A cancelled waiter detaches without cancelling another authorized consumer; underlying work stops when no consumer remains. The initial host profile permits two expensive preparations and 32 pending requests, with deadlines covering queue time. A full queue returns unavailable preparation with `context_budget_exceeded`, not empty evidence. A different resource-class profile needs its own benchmark binding.

Retain at most one current prepared generation per project/scope/plan/profile and one leased predecessor until its final reader releases it or its declared deadline expires. Enforce the host profile's total byte budget across projects and scopes through the existing resource-pressure eviction policy; reject profiles without that budget. Do not retain one index per turn. Late completion after invalidation cannot become current.

Exact-content caches remain rebuildable under ADR-0499 and ADR-0500. There is no unbounded request-text or task-result cache. Cross-host hosts may compare source and build identities but never trust another host's claim of current authorization or local bytes. Hub absence does not prevent local execution.

## Events and privacy

Proposed `context.quality.prepared` schema 1 requires the canonical event envelope plus `requestId`, `taskRevision`, `semanticInputDigest`, `planDigest`, `sourceSnapshotId`, `scopeDigest`, `policySetDigest`, `profileId`, `executionMode`, `originKind`, `adapterBuildId`, `status`, `reasonCodes`, required/resolved/loaded counts, evidence/section counts, coverage disposition, report artifact reference, and preparation stage-observation references. It records one terminal preparation outcome per attempt. It proves neither provider delivery nor relevance.

Proposed `context.quality.verified` schema 1 requires the envelope plus `requestId`, `planDigest`, `artifactDigest`, `verificationDefinitionId`, `verificationDefinitionHash`, `evaluatorBuildId`, `disposition`, `reasonCodes`, and verification artifact reference. It records an observation, not a publication permit or unconditional completion. Repeating an identical observation is idempotent; conflicting content under one event identity is rejected. Existing E1-E4 events retain provider session/turn delivery bindings and are correlated by immutable references.

Required coordinate and artifact-reference fields may be null only when an unavailable, incomplete, stale, or cancelled observation could not establish that coordinate, with the matching reason code. A passed verification requires non-null plan, artifact, definition, evaluator, and verification evidence coordinates. Ready and no-evidence preparation require every semantic binding and complete coverage denominator; null never becomes an invented hash or a zero count.

Events contain only bounded identifiers, digests, counts, dispositions, and existing observation references. Exclude prompts, query text, clause bodies, provider output, absolute paths, secrets, and reviewer identities. Source clauses and private evaluation cases remain in authorized canonical sources or existing access-controlled artifacts; a hash does not declassify their content. Report artifact references obey the same access scope as the source.

Persist events and artifacts through existing stores and retention owners; create no per-turn tracked file directory. Rebuild one current report projection per active task, remove it when the task retires, and retain history only under canonical event/artifact retention. A report-size overflow is incomplete evidence, not successful truncation. Event-recording failure leaves no durable success claim; direct hooks remain availability-safe while controlled consequential effects require their existing durable evidence.

Readers land before writers. Unknown schema versions and unsupported states remain explicitly unavailable; they are never coerced to empty success. Downgrade keeps old observations readable through the established reader window or disables the new writer. Engine rollback and protocol rollback are separate, exact transitions.
