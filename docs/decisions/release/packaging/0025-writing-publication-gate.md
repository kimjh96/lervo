# ADR-0025: Human-facing publication gate and content-bound permits

Status: `accepted`
Decision date: 2026-08-19

## Context

A provider result artifact proves execution and CAS integrity, not readable human prose. A pure writing contract cannot stop CLI code from reading or printing source before evaluation, and deterministic regular expressions cannot establish natural-language quality. A boolean result could be reused with different content, policy, or surfaces. Events cannot store evaluated source or evaluator errors without violating source minimization.

## Decision

### Separate evaluation from publication reads

Provider-independent `@lervo/writing` accepts a writing contract, surface, result-artifact coordinates, local artifact store, and optional `WritingSemanticEvaluator` port. It:

1. Reads CAS source and verifies media type, ID/URI, digest, byte count, the 4 MiB limit, and lossless UTF-8.
2. Runs deterministic `@lervo/core` checks and skips semantic evaluation after any failure.
3. Calls the separately injected evaluator only after deterministic success, passing policy, locale, surface, artifact coordinates, source, and required check definitions.
4. Accepts only a `model` or `human` evaluator ID and exactly one `passed` or `failed` result, including a violation count, for every required check. Missing, duplicate, unknown, contradictory, or exceptional responses never pass.
5. Computes per-check evidence digests, the derived overall status, and a content-addressed evaluation ID; stores canonical evaluation JSON in CAS and verifies read-back.

Consumers call `readPublishableWritingArtifact`, which revalidates evaluation schema, semantics, CAS bytes, current policy, and permit before returning source. Only this result may be printed by the CLI. Shared-context and deliberation publishers use the same boundary for human-facing source.

### Bind permits to all decision inputs

`WritingPublicationPermit` contains:

- `permitId`, `issuedAt`, `surface`
- `artifactId`, `contentHash`
- `writingPolicyId`, `writingPolicyHash`
- `evaluationId`, `evaluationHash`

Derive `permitId` as the SHA-256 of canonical content excluding the ID. Any change to source, policy body, evaluation JSON, or surface invalidates reuse. Issue a permit only when every required check passes. This slice returns permits without a persistent permit store.

### States and failures

Publication states are:

- `allowed`: evaluation passed, a permit exists, and content is publishable.
- `blocked`: `failure=writing_verification_failed`, `permit=null`, and `content=null`, with missing or failed check IDs and coordinate-mismatch status.

Semantic-attempt states are independent:

- `completed`: a valid response arrived; individual check failures may still block publication.
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

Evaluation artifacts contain only policy and artifact coordinates, evaluator ID, check status, count, evidence digest, and times. Exclude provider source, prompts, tool input, payloads, and evaluator exception bodies. The evaluator receives source in memory but does not echo it.

Add no event type or field. An evaluation or permit does not imply Hub transfer, shared-context publication, another role's E2/E3, E4, or knowledge promotion. The fixed developer role remains `presentation.audience=machine` without a writing policy; post-generation evaluation must not be represented as pre-generation policy injection.

### Module boundaries

- `@lervo/core`: default policy, deterministic lint, and pure gate
- `@lervo/schemas`: writing surface and permit structures
- `@lervo/writing-contract`: canonical policy, evaluation, and permit identities
- `@lervo/writing`: artifact integrity, evaluator port, evaluation, permit, and publication read
- `@lervo/cli`: composition, output, and exit status

Filesystem-CAS and provider fixtures cover successful read-back and publication, missing evaluator, deterministic short-circuit, duplicate response, evaluator exception, and permit rejection after surface, policy, or content changes. A missing evaluator hides source and exits 1 while retaining `run.completed` and the file change.

## Consequences

The CLI no longer reads result artifacts directly. Unevaluated text is never inferred to be natural prose. Passing evidence is reusable only with the exact policy, evaluation, source, and surface coordinates. ADR-0026 binds permits to deliberation artifacts.

## 2026-08-23 publication-language amendment

Replace the former fixed Korean default with a publication-language contract. Version 1 supports only `en` and resolves `writing_en-human` from knowledge policy `publication.language`. Unsupported languages fail before a managed run or deliberation starts. Schema, policy hash, evaluator request, permit, and artifacts remain provider-neutral.

Managed deliberation injects the resolved English writing contract before generation. Role descriptions, prompts, the exact verdict protocol (`Verdict: approved` or `Verdict: revision required`), semantic evaluation, and final publication all use its locale. The ordinary developer run remains machine-audience generation followed by separate English publication evaluation and therefore does not claim injection without evidence.

Add no event field. Unsupported-language errors expose only the identifier. Verdict-parse failures expose only expected protocol markers, never provider prose, prompts, or repository content.

## 2026-08-23 local managed-run evaluator amendment

Production `lervo run` composition supplies the previously test-only semantic evaluator port. After the managed file change and project verification complete, Lervo starts a separate read-only session with the selected local provider. The evaluator runs in a newly created empty temporary repository, receives one inline fixed evaluation protocol, receives result-artifact source only in its turn request, and has every managed write denied. Lervo removes the temporary repository after the session stops. No Hub or external semantic service is required.

The response remains the exact bounded JSON check set and passes through the existing parser, evaluation artifact, and permit validation. Evaluator request source, provider payloads, and errors do not enter events. Only the content-bound writing evaluation stores evaluator ID, statuses, counts, and evidence digests. Missing, failed, malformed, or non-passing evaluation continues to hide provider prose and makes the CLI exit nonzero while preserving the verified repository change.

## 2026-08-25 evaluator reader-context amendment

Semantic evaluation requests include the writing contract's intended audience and prose register. These fields guide the separate evaluator but do not enter evaluation artifacts, permits, or events. Omitting them made the phrase "intended reader" ambiguous and caused technical deliberation documents to be judged as if they targeted an unspecified general audience. The request remains provider-neutral and content-bound; malformed or missing reader context fails at the typed composition boundary before publication.

The plain-language semantic check explicitly instructs the evaluator to judge clarity against that audience and register. Standard software terms are acceptable in a technical specification, while repository-specific terms, uncommon abbreviations, and machine identifiers still require a definition at first use or in a Terms section. This clarification changes the writing-policy hash, so older evaluations and permits cannot be reused under the amended policy.

Managed deliberation prompts also bound publishable proposal, review, revision, verification, and decision lengths. They require plain-language meaning before repository identifiers and a short glossary when several identifiers are necessary. These generation constraints reduce avoidable semantic failures without weakening the same publication checks.

Managed deliberation may run one fresh provider turn after `writing_publication_blocked`. The retry receives the original task plus a fixed instruction to audit and explain internal vocabulary; it does not receive evaluator output or the unpublished draft. The second result passes the complete publication gate independently or the deliberation retains the existing `artifact_publication_failed` terminal failure. The failed run remains observable as ordinary execution events but creates no deliberation artifact, shared context, handoff, or claim that its text was published.

The managed developer role also includes a short result protocol in its role-policy digest and appends it to the provider turn: use complete English sentences, state the result and effect, and state a next action or that none remains. This is a machine-result formatting contract, not `writingPolicyId` injection or E3 evidence for the human writing policy. Ordinary runs may evaluate with the same provider in a separate session; unlike ADR-0133 deliberation, this does not claim independent cross-provider review.
