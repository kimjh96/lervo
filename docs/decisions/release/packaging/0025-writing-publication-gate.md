# ADR-0025: Human-facing publication gate and content-bound permits

Status: `accepted`
Decision date: 2026-08-19

## Context

A provider result artifact proves execution and CAS integrity, not readable human prose. A pure writing contract cannot stop CLI code from reading and printing source before evaluation, and deterministic regular expressions cannot establish natural language quality. A boolean result is reusable against different content, policy, or surfaces; storing evaluated source or evaluator errors in events would break source minimization.

## Decision

### Separate evaluation from publication reads

Provider-independent `@lervo/writing` accepts a writing contract, surface, result-artifact coordinates, local artifact store, and optional `WritingSemanticEvaluator` port. It:

1. Reads CAS source and verifies media type, ID/URI, digest, byte count, 4 MiB limit, and lossless UTF-8.
2. Runs deterministic `@lervo/core` checks; any failure skips semantic evaluation.
3. Calls the separately injected evaluator only after deterministic success, passing policy/locale/surface/artifact coordinates, source, and required check definitions.
4. Accepts only a `model` or `human` evaluator ID and exactly one `passed`/`failed` result plus violation count for every required check. Missing, duplicate, unknown, contradictory, or exceptional responses never pass.
5. Computes per-check evidence digests, derived overall status, and content-addressed evaluation ID; stores canonical evaluation JSON in CAS and verifies read-back.

Consumers call `readPublishableWritingArtifact`, which revalidates evaluation schema/semantics/CAS bytes, current policy, and permit before returning source. CLI prints only this result. Shared-context and deliberation publishers must use the same boundary for human-facing source.

### Bind permits to all decision inputs

`WritingPublicationPermit` includes:

- `permitId`, `issuedAt`, `surface`
- `artifactId`, `contentHash`
- `writingPolicyId`, `writingPolicyHash`
- `evaluationId`, `evaluationHash`

Derive `permitId` as SHA-256 of canonical content excluding the ID. Changed source, policy body, evaluation JSON, or surface invalidates reuse. Issue only when every required check passes. This slice returns permits without adding a persistent permit store.

### States and failures

- Publication `allowed`: evaluation passed, permit exists, and content is publishable.
- Publication `blocked`: `failure=writing_verification_failed`, `permit=null`, `content=null`, with missing/failed check IDs and coordinate-mismatch status.

Semantic attempt status is independent:

- `completed`: valid response received; individual failures may still block.
- `not_run`: no evaluator or deterministic failure.
- `failed`: evaluator invocation threw.
- `invalid`: response check set or status violated contract.

| Code | Meaning |
| --- | --- |
| `invalid_writing_request` | Surface not allowed or invalid clock; do not evaluate or publish. |
| `artifact_contract_invalid` | Invalid result media/coordinates/size; skip semantic evaluation. |
| `artifact_storage_failed` | Source/evaluation CAS read or verification failed. |
| `evaluation_contract_invalid` | Invalid schema, check/evaluator set, derived status, or ID; issue no permit. |
| `publication_permit_invalid` | Permit differs from current surface/policy/evaluation/content; return no source. |

`writing_verification_failed` is a normal fail-closed decision, not a contract error. Preserve the provider run and verified file change, hide only result source, and have CLI exit 1 with an explanation.

### Privacy and evidence limits

Evaluation artifacts contain only policy/artifact coordinates, evaluator ID, check status/count/evidence digest, and times. Exclude provider source, prompts, tool input, payloads, and evaluator exception bodies. The evaluator receives source in memory but does not echo it.

Add no event type or field. Evaluation/permit existence does not imply Hub transfer, shared-context publication, another role's E2/E3, E4, or knowledge promotion. The fixed developer role remains `presentation.audience=machine` with no writing policy; post-generation evaluation must not be presented as pre-generation policy injection.

### Module boundaries

- `@lervo/core`: default policy, deterministic lint, pure gate
- `@lervo/schemas`: writing surface and permit structures
- `@lervo/writing-contract`: canonical policy/evaluation/permit identities
- `@lervo/writing`: artifact integrity, evaluator port, evaluation, permit, publication read
- `@lervo/cli`: composition, output, exit status

Filesystem-CAS and provider fixtures cover successful read-back/publication, missing evaluator, deterministic short-circuit, duplicate response, evaluator exception, and permit rejection after surface/policy/content changes. A missing evaluator hides source and exits 1 while retaining `run.completed` and the file change.

## Consequences

CLI no longer reads result artifacts directly. Unevaluated text is never inferred to be natural prose, and passing evidence is reusable only for exact policy, evaluation, source, and surface coordinates. ADR-0026 binds permits to deliberation artifacts.

## 2026-08-23 publication-language amendment

The former fixed Korean default is replaced by a publication-language contract. Version 1 supports `en` only and resolves `writing_en-human` from knowledge policy `publication.language`. Unsupported languages fail before a managed run or deliberation starts; schema, policy hash, evaluator request, permit, and artifacts remain provider-neutral.

Managed deliberation injects the resolved English writing contract before generation. Role descriptions, prompts, exact verdict protocol (`Verdict: approved` or `Verdict: revision required`), semantic evaluation, and final publication all use its locale. The ordinary developer run remains machine-audience generation followed by separate English publication evaluation, so it does not claim injection without evidence.

No event field was added. Unsupported-language errors expose only the identifier, and verdict-parse failures only expected protocol markers—never provider prose, prompts, or repository content.

## 2026-08-23 local managed-run evaluator amendment

The production `lervo run` composition now supplies the previously test-only semantic evaluator port. After the managed file change and project verification complete, Lervo starts a separate read-only session with the selected local provider. The evaluator runs in a newly created empty temporary repository, receives one inline fixed evaluation protocol, receives the result artifact source only in its turn request, and has every managed write denied. Lervo removes the temporary repository after the session stops. This path requires neither a Hub nor an external semantic service.

The evaluator response must still be the exact bounded JSON check set and passes through the existing parser, evaluation artifact, and permit validation. Evaluator request source, provider payloads, and errors do not enter events. Only the content-bound writing evaluation stores the evaluator ID, statuses, counts, and evidence digests. A missing, failed, malformed, or non-passing evaluation continues to hide provider prose and make the CLI exit nonzero while preserving the verified repository change.

The managed developer role also carries a short result protocol in its role-policy digest and appends that protocol to the provider turn: use complete English sentences, state result and effect, and state a next action or that none remains. This is a machine-result formatting contract, not `writingPolicyId` injection and not E3 evidence for the human writing policy. Ordinary runs may evaluate with the same provider in a separate session; unlike ADR-0133 deliberation, this does not claim independent cross-provider review.
