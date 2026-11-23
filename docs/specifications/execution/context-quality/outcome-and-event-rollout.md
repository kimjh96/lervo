# Context outcomes and reader-first event rollout

Status: `implemented_subset`
As of: 2026-10-09

This page records the source boundary for owner work items 6–9 under [ADR-0501](../../../decisions/execution/grounding/0501-share-context-quality-contracts-across-product-surfaces.md). It does not establish production-quality acceptance or installed rollout. [The acceptance protocol](performance-and-acceptance.md) remains authoritative.

## Artifact observations

`verifyRepositoryContextOutcome` re-prepares the exact local request before and after evaluating an artifact. Both plans must match the expected digest. Current policy, scoped rules, candidate bytes, target paths, and local read scope participate in that comparison. The artifact is read again after evaluation. A changed plan or artifact returns `unavailable` with `context_binding_stale`; it cannot retain a passed verdict.

The original version-1 observation binds plan and artifact digests, optional protected baseline digest, verification definition ID/hash, evaluator build, writing evaluation digest, disposition/reasons, observation time, and observation digest. Its explicit scope is `publication_writing_and_protected_material`. It grants no publication permit and does not assert that every task constraint passed. Existing managed verification suites and writing publication permits retain their authority.

English publication uses the existing versioned writing contract. Deterministic failures remain failures even when semantic evaluation is unavailable. A caller may supply the existing `WritingSemanticEvaluator` port; absent or failed semantic evaluation returns `unavailable`. Chat-only artifacts are `not_applicable`. Unsupported publication languages remain unavailable unless the subsequent [task outcome and correction slice](task-outcome-correction.md) receives an exact scoped exception from its authority resolver.

Protected material is a multiset of exact UTF-8 Markdown source hashes for block quotations, fenced or indented code, and inline code. The original baseline must be supplied when preservation is requested. Reordering unchanged blocks is allowed; changed bytes, deletion, and changed multiplicity fail. This does not detect every natural-language quotation or infer ownership of a supplied baseline. Artifact and baseline inputs are bounded to 1 MiB. Verification is read-only. The separate bounded correction operation evaluates proposals before invoking an independently authorized effect owner.

The query entrypoint supports:

```text
lervo knowledge query "task" --json
lervo knowledge query "task" --verify-artifact docs/result.md --expected-plan sha256:... --baseline docs/original.md --json
```

Repeat the original target, artifact-kind, action, and continuation arguments. `--expected-plan` binds the earlier query result. This CLI path runs no hidden provider turn, so missing semantic evaluation produces exit status 2 and an unavailable observation. It is useful for deterministic failures and freshness diagnosis, not a standalone English-publication approval. [Task-specific verification, bounded language exceptions, and controlled correction](task-outcome-correction.md) are implemented as shared callable operations. [Host completion integration](host-outcome-integration.md) connects these operations to actual managed, conversation, and terminal boundaries.

## Event compatibility and storage

Reader envelope version 6 adds `context.quality.prepared` and `context.quality.verified`. Earlier envelopes retain their closed event-name sets. Readers advertise versions 1–6; the default writer remains 1, and automatic maintenance activation still targets version 5. Explicit version-6 activation uses the existing fresh reader-inventory evidence and exact apply-plan contract. Writer-coordinate schema 5 selects event schema 6.

Apply takes a private copy of the approved plan before asynchronous work and compares the complete plan with a fresh recomputation. A mismatch, including changed publication bytes, fails with `event_writer_plan_stale` before staging. Invalid reader evidence retains its existing validation failures. The verified plan supplies the coordinate bytes, recovery journal and receipt. Later caller mutation cannot change the admitted operation or its reported result. Existing reader-inventory checks, transaction recovery and rollback remain required.

Preparation payload schema 1 carries attempt ID, nullable trusted task/scope/policy/source/profile coordinates, origin and adapter build, explicit execution mode, status/reasons, required/resolved/loaded and evidence/section counts, coverage disposition, report artifact hash, and bounded stage-observation hashes. Pre-binding failures retain null coordinates; they cannot appear ready or complete. Counts must be consistent. Current local preparation records `unmanaged`, including when a managed host requests this local read-only preparation. That observation does not replace the host's separate E1–E3 delivery evidence.

Verification payload schema 1 carries request ID, plan and artifact digests, verification definition ID/hash, evaluator build, disposition/reasons, and verification artifact hash. Neither payload contains task text, document bodies, credentials, or arbitrary error prose. Strict schemas and the event redaction allowlist reject unknown reason values and invalid coordinates. Details stay in the existing private CAS under its retention owner.

Knowledge query requests preparation recording automatically and records requested outcome verification; `--record` remains a compatibility flag. Recording is inactive unless the repository explicitly selects writer 6 or later. CAS writes are read back and verified before event append. The event store makes identical preparation retries idempotent and rejects conflicting content under the same attempt identity. Verification identity includes the exact observation digest. Recording failure returns `unavailable`; it never returns a durable-success receipt. No tracked per-turn files or parallel event history are created.

Rollback uses the existing exact writer rollback plan. It stops new quality events while preserving schema-6 history; any reader processing that history must remain version-6 capable. [Host integration](host-outcome-integration.md) now requests quality recording at preparation and completion alongside existing evidence paths. Older writer selections still suppress these new events.

## Evaluation and installation boundaries

The [recording-overhead protocol](../../../../benchmarks/context-quality/recording-overhead-v1.json) freezes a diagnostic comparison of optional recording against the same candidate build while writer 1 is selected. It uses 30 alternating fresh-process warm pairs, five application-cold pairs, separately retained warmups, paired bootstrap intervals, fixed noninferiority margins, and zero provider calls. It reports CPU, memory, process/preparation time, prepared bytes, failures, and semantic plan parity. Operating-system caches remain uncontrolled. This experiment measures inactive-writer overhead only; it cannot establish retrieval quality, a speedup against the pre-feature product, changed-source/concurrent performance, or provider parity.

Run the protocol after building:

```text
node scripts/evaluation/run-context-quality-performance.mjs
```

Retain every reviewed regression family. The design's 100 real task families, human-reviewed labels, family-level held-out split, stochastic provider repetitions, changed-source/concurrent measurements, and seven-day installed cohort remain independent gates. Authored unit fixtures and an installed scratch package cannot satisfy them. New readers may be qualified in isolated installations; supported-surface rollout and version-6 writer activation require the corresponding exact build and acceptance evidence.

The [source verification record](../../../evidence/quality/context-quality/context-quality-source-verification.md) contains the exact source and installed-consumer evidence, the retained rejected cold cohort, and the passing same-build diagnostic. The [diagnostic protocol](../../../../benchmarks/context-quality/cold-recording-diagnosis-v1.json) preregisters 30 warm and 30 cold pairs with the same resource gates and ten independent phase probes. Run it with `node scripts/evaluation/run-context-quality-performance.mjs --protocol benchmarks/context-quality/cold-recording-diagnosis-v1.json`; complete builds, tests, installations, and knowledge scans before measurement. A passing inactive-writer diagnostic does not qualify active-writer storage or fleet rollout.
