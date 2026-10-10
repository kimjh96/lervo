# Context preparation observations

Status: `active`
As of: 2026-10-09

This first implementation slice of [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md) observes existing preparation without changing ranking, provider calls, or prompt capacity. It is a baseline diagnostic contract, not the proposed `ContextQualityRequestV1` or `ContextQualityPlanV1`. The [request/plan validation slice](request-plan-validation.md) provides pure validation and a private coordinator; the [runtime composition](runtime-preparation.md) now supplies current local-read, applicability and profile bindings while keeping corpus/token completeness unobserved.

## Owners and consumers

`@lervo/schemas` owns `ContextPreparationReport` schema 1. `@lervo/context` validates bounded selection/loading observations and produces the report without filesystem, provider, transport, clock, or event effects. `@lervo/repository-context` translates existing search recommendation batches and graph selections into that observation. It preserves ranking and validates batch receipts before projecting them.

| Consumer                               | Observation boundary                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Codex and Claude compact hooks         | Retrieval did not run; no selected or loaded publications                                                                           |
| Codex and Claude retrieval hooks       | Selected exact source versions, full/prefix preparation, and failed loads                                                           |
| Managed CLI and Node search            | Existing candidate/selection receipts; final context loading remains unobserved                                                     |
| Conversation repository context        | Returns the shared search report; required workstream context added later is outside its selection denominator                      |
| Operational-only conversation fallback | Knowledge corpus coverage is incomplete; an operational search result does not hide that limit                                      |
| Native-chat fixture                    | Normalized inbound content reaches the same conversation application path; this does not establish installed first-party acceptance |

Direct `knowledge query` now exposes the separate [applied-instruction report](applied-instructions.md). Terminal diagnostics optionally include the same owner-rule report. Later managed document loading/delivery and repository-work result presentation are not yet connected to the full quality-plan diagnostic. Existing E1-E4 evidence continues independently. The old CLI-local search implementation is now a compatibility facade; `managed-run` imports the shared repository-context application.

## Shape and meanings

New reports also contain optional `planningReadiness`, with unavailable status, `context_binding_unavailable`, and the missing normalized-task, authority, policy, snapshot, plan, profile, build, and capability bindings. Historical reports without this field remain readable. These names reveal no request text or source details.

Every report requires `schemaVersion`, `contractId=context_preparation_observation_v1`, `requestDigest`, nullable `sourceSnapshotId`, `observationDigest`, retrieval disposition, nullable candidate count, selected count, loading disposition, nullable full/prefix/unavailable counts, nullable prepared byte count, reason codes, and explicit applicability/corpus/delivery/use/artifact limitations.

The input permits at most 50 distinct selected source versions and one loading observation per selected version. A duplicate source ID, conflicting version, unselected load, missing load record, impossible count, or out-of-bound value fails validation with a fixed diagnostic that excludes caller content. A source is bounded at 131,072 prepared bytes. The report contains no source IDs, paths, query text, source bodies, or provider output. Schema readers reject unknown versions and extra fields.

`completed` retrieval means the existing query operation returned; it does not establish relevant-source recall or complete corpus coverage. `not_run` and `unavailable` use a null candidate count. A completed empty search has zero candidates and still cannot establish source absence. `loading=unobserved` uses null counts and bytes, not invented zeros. Search index reads are not final context loading.

Observed full, prefix, and unavailable counts partition the selected versions. Prefix bytes include the existing truncation notice; they are prepared text bytes, not a verified source section range. Empty source files may have zero full bytes. Current retrieval-mode preparation selects complete exact sections instead of prefixes. Legacy readers retain prefix support, while section-only loading stays unobserved in this older report rather than being coerced to full/prefix. The unchanged compact envelope is 4,096 bytes and retrieval envelope is 28 KiB. Reports are outside provider prompt text.

| Reason                  | Meaning                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `retrieval_not_run`     | Compact preparation intentionally did not search               |
| `retrieval_unavailable` | No usable projected query was available                        |
| `loading_unobserved`    | This operation cannot observe final context loading            |
| `corpus_incomplete`     | The operational-only path does not cover repository knowledge  |
| `source_unavailable`    | Source open/read failed or the selected file disappeared       |
| `source_unsafe`         | A checked path, file type, or final symlink was unsafe         |
| `source_oversized`      | The source exceeds the existing read ceiling                   |
| `source_changed`        | Current bytes or read-time file identity differ from selection |
| `source_invalid_utf8`   | Exact selected bytes cannot be decoded as UTF-8                |
| `capacity_exhausted`    | The source could not be prepared within the remaining envelope |
| `prefix_only`           | Only the existing bounded prefix was prepared                  |

The observation digest binds the request digest, source snapshot, corpus disposition, retrieval result, ordered selected versions, and load results. Load completion order is normalized to selection order. Receipt IDs, timestamps, and surface identity do not enter this digest. It is not a semantic input digest, authorization token, cache key, or parity proof: terminal request digests and managed normalized-query digests currently bind different inputs.

Applicability, provider delivery, and artifact compliance remain `unobserved`; internal use remains `unknown`. Corpus coverage is `unobserved` or explicitly `incomplete`, never complete. No report permits an effect or establishes a successful quality plan.

## Storage and compatibility

Terminal activation receipts optionally carry `preparationQuality`, visible through `lervo terminal status --json`. This uses the existing bounded current receipt per provider/hook, with no new history collection or event type. Historical receipts without the field remain readable. An unsupported or malformed optional report is omitted by the reader while the historical activation record remains readable; absence means no supported diagnostic, never a successful empty observation.

Managed search and conversation preparation return the report in memory. No `context.quality.prepared` or `context.quality.verified` event writer is activated. Existing hook availability-safe behavior and existing managed errors are preserved. Canonical source and existing event evidence remain authoritative; activation diagnostics are a replaceable local observation.

## Verification and remaining work

Focused tests cover exact-version identity, incidental load order, bounded failures, empty versus unavailable retrieval, privacy, malformed reports, historical readers, changed/deleted/oversized/invalid-UTF-8/symlink sources, both terminal adapters, operational fallback, and normalized native-chat composition. Existing terminal tests retain their provider-call and prompt-byte assertions.

The [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md) records the newer runtime bindings, deterministic applicability and section selection separately, and retains real-task evaluation, artifact verification, protocol rollout and installed acceptance. This slice adds diagnostic coverage; it does not claim Hit improvement, latency improvement, full surface parity, or installed rollout.
