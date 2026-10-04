# ADR-0025: Human-facing publication gate and content-bound permits

Status: `accepted`
Decision date: 2026-08-19

## Context

A provider result artifact proves execution and content-addressed storage (CAS) integrity, not readable human prose. A writing contract cannot prevent CLI code from reading or printing unevaluated source. Deterministic regular expressions cannot establish natural-language quality. A boolean result could be reused with different content, policy, or surfaces. Storing evaluated source or evaluator errors in events violates source minimization.

## Decision

### Separate evaluation from publication reads

Provider-independent `@lervo/writing` accepts a writing contract, surface, result-artifact coordinates, local artifact store, and optional `WritingSemanticEvaluator` port. It:

1. Reads CAS source and verifies media type, ID/URI, digest, byte count, the 4 MiB limit, and lossless UTF-8.
2. Runs deterministic `@lervo/core` checks; any failure skips semantic evaluation.
3. After deterministic success, calls the injected evaluator with policy, locale, surface, artifact coordinates, source, and required check definitions.
4. Accepts only a `model` or `human` evaluator ID and exactly one `passed` or `failed` result, with a violation count, for each required check. Missing, duplicate, unknown, contradictory, or exceptional responses never pass.
5. Computes per-check evidence digests, derived overall status, and a content-addressed evaluation ID; stores canonical evaluation JSON in CAS and verifies read-back.

Consumers call `readPublishableWritingArtifact`, which revalidates evaluation schema, semantics, CAS bytes, current policy, and permit before returning source. Only this result may be printed by the CLI. Shared-context and deliberation publishers use the same boundary for human-facing source.

### Bind permits to all decision inputs

`WritingPublicationPermit` contains:

- `permitId`, `issuedAt`, `surface`
- `artifactId`, `contentHash`
- `writingPolicyId`, `writingPolicyHash`
- `evaluationId`, `evaluationHash`

Derive `permitId` as the SHA-256 of canonical content excluding the ID. Any source, policy-body, evaluation-JSON, or surface change invalidates reuse. Issue a permit only when every required check passes. This slice returns permits without a persistent permit store.

### States and failures

Publication states:

- `allowed`: evaluation passed, a permit exists, and content is publishable.
- `blocked`: `failure=writing_verification_failed`, `permit=null`, and `content=null`, with missing or failed check IDs and coordinate-mismatch status.

Independent semantic-attempt states:

- `completed`: a valid response arrived; failed checks may still block publication.
- `not_run`: no evaluator was available or deterministic checks failed.
- `failed`: evaluator invocation threw.
- `invalid`: the response check set or status violated the contract.

| Code | Meaning |
| --- | --- |
| `invalid_writing_request` | Surface is not allowed or the clock is invalid; do not evaluate or publish. |
| `artifact_contract_invalid` | Result media, coordinates, or size is invalid; skip semantic evaluation. |
| `artifact_storage_failed` | Source or evaluation CAS read or verification failed. |
| `evaluation_contract_invalid` | Schema, check/evaluator set, derived status, or ID is invalid; issue no permit. |
| `publication_permit_invalid` | Permit differs from the current surface, policy, evaluation, or content; return no source. |

`writing_verification_failed` is a normal fail-closed decision, not a contract error. Preserve the provider run and verified file change, hide only result source, and make the CLI exit 1 with an explanation.

### Privacy and evidence limits

Evaluation artifacts contain only policy and artifact coordinates, evaluator ID, check status, count, evidence digest, and times. They exclude provider source, prompts, tool input, payloads, and evaluator exception bodies. The evaluator receives source in memory but does not echo it.

Add no event type or field. An evaluation or permit does not imply Hub transfer, shared-context publication, another role's E2/E3, E4, or knowledge promotion. The fixed developer role remains `presentation.audience=machine` without a writing policy. Post-generation evaluation must not be represented as pre-generation policy injection.

### Module boundaries and validation

- `@lervo/core`: default policy, deterministic lint, and pure gate.
- `@lervo/schemas`: writing surface and permit structures.
- `@lervo/writing-contract`: canonical policy, evaluation, and permit identities.
- `@lervo/writing`: artifact integrity, evaluator port, evaluation, permit, and publication read.
- `@lervo/cli`: composition, output, and exit status.

Filesystem-CAS and provider fixtures cover successful read-back and publication, missing evaluator, deterministic short-circuit, duplicate response, evaluator exception, and permit rejection after surface, policy, or content changes. A missing evaluator hides source and exits 1 while retaining `run.completed` and the file change.

## Consequences

The CLI no longer reads result artifacts directly. Unevaluated text is never inferred to be natural prose. Passing evidence is reusable only with the exact policy, evaluation, source, and surface coordinates. ADR-0026 binds permits to deliberation artifacts.

## 2026-08-23 publication-language amendment

Replace the fixed Korean default with a publication-language contract. Version 1 supports only `en` and resolves `writing_en-human` from knowledge policy `publication.language`. Unsupported languages fail before a managed run or deliberation starts. Schema, policy hash, evaluator request, permit, and artifacts remain provider-neutral.

Managed deliberation injects the resolved English writing contract before generation. Role descriptions, prompts, the exact verdict protocol (`Verdict: approved` or `Verdict: revision required`), semantic evaluation, and final publication all use its locale. Ordinary developer runs remain machine-audience generation followed by separate English publication evaluation; they do not claim injection without evidence.

Add no event field. Unsupported-language errors expose only the identifier. Verdict-parse failures expose only expected protocol markers, never provider prose, prompts, or repository content.

## 2026-08-23 local managed-run evaluator amendment

Production `lervo run` composition supplies the formerly test-only semantic evaluator port. After the managed file change and project verification complete, Lervo starts a separate read-only session with the selected local provider. The evaluator runs in a newly created empty temporary repository, receives one inline fixed evaluation protocol, receives result-artifact source only in its turn request, and has every managed write denied. Lervo removes the temporary repository after the session stops. No Hub or external semantic service is required.

The response remains the exact bounded JSON check set and passes through the existing parser, evaluation artifact, and permit validation. Evaluator request source, provider payloads, and errors do not enter events. Only the content-bound writing evaluation stores evaluator ID, statuses, counts, and evidence digests. Missing, failed, malformed, or non-passing evaluation hides provider prose and makes the CLI exit nonzero while preserving the verified repository change.

## 2026-08-25 evaluator reader-context amendment

Semantic evaluation requests include the writing contract's intended audience and prose register. These fields guide the separate evaluator but do not enter evaluation artifacts, permits, or events. Without them, "intended reader" was ambiguous and technical deliberation documents could be judged for an unspecified general audience. The request remains provider-neutral and content-bound. Malformed or missing reader context fails at the typed composition boundary before publication.

The plain-language semantic check judges clarity against that audience and register. Standard software terms are acceptable in a technical specification. Repository-specific terms, uncommon abbreviations, and machine identifiers require a definition at first use or in a Terms section. This clarification changes the writing-policy hash; older evaluations and permits cannot be reused under the amended policy.

Managed deliberation prompts bound publishable proposal, review, revision, verification, and decision lengths. Exact repository paths are optional and appear only when their location is necessary to understand the conclusion. Every retained internal term requires a reader-facing explanation. Product and version labels remain only when the name itself is material and the same sentence explains its user behavior or compatibility boundary.

After a `plain_audience_language` failure, the fresh-turn repair contract overrides ordinary evidence-path guidance. It forbids paths, file and command names, backticked names, abbreviations, repository-specific state names, hashes, and machine identifiers. It replaces avoidable product, protocol, stage, and version labels with behavior and limits the fresh response to eight paragraphs and 450 English words or Korean space-delimited words. Repaired prose describes observed behavior and why it supports the conclusion; managed run events and context receipts preserve the exact evidence binding separately. This removes contradictory generation instructions and prevents revisions from restating every internal coordinate without weakening the semantic publication gate or underlying evidence contract.

Managed deliberation may run one fresh provider turn after `writing_publication_blocked`. The retry receives the original task and a fixed instruction to audit and explain internal vocabulary, but neither evaluator output nor the unpublished draft. The second result must independently pass the complete publication gate; otherwise, deliberation retains the existing `artifact_publication_failed` terminal failure. The failed run remains observable as ordinary execution events but creates no deliberation artifact, shared context, handoff, or claim that its text was published.

The managed developer role includes a short result protocol in its role-policy digest and appends it to the provider turn: use complete English sentences, state the result and effect, and state a next action or that none remains. This is a machine-result formatting contract, not `writingPolicyId` injection or E3 evidence for the human writing policy. Ordinary runs may evaluate with the same provider in a separate session; unlike ADR-0133 deliberation, this does not claim independent cross-provider review.
