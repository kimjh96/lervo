# ADR-0249: Authorize isolated registered-corpus phase A pilot

Status: `accepted`

## Context

[ADR-0248](../0248-stage-linked-evidence-reconciliation-activation.md) requires at least 30 eligible managed-run observations, 10 nonempty linked-candidate projections, zero unavailable or privacy failures, exact replay equality, and explicit review of every truncation before phase A advances. This repository cannot supply that population: its production document registry is empty, so the checked-in v8 queries produce no operational lexical recommendations or linked candidates. Adopting documents would change operational search and managed context; changing the shadow seed would revise the accepted projection contract.

The user approved the preflight recommendation to run unchanged production behavior in an isolated representative repository with an explicitly registered Markdown corpus. Evidence from the pilot applies only to that population, not repositories with different registries, corpora, or query distributions.

## Decision

### Bind one deletable isolated population

Create exactly one pilot beneath `.lervo/state/search/linked-evidence-shadow-pilots/`. It is derived, owner-only local state, removable as one bounded directory after recording evidence. It must not change this repository's project identity, document registry, operational search state, knowledge store, managed E1-E4 context, or direct-terminal behavior.

Prepare it from the current checked-in v8 corpus roots and exclusions plus this ADR's path exclusion. Copy the resulting Markdown bytes into a new Lervo project, register every document under a stable path-derived document ID, and bind the following in one owner-only prepared manifest: ordered IDs and paths, content hashes, corpus digest, source revision and working-tree-status digest, project ID, built CLI digest, suite digest, contract digest, schedule, and dry-run projection result. A pilot-specific `AGENTS.md` prefix may restrict writes to the declared output file; its exact resulting bytes and hash belong to the registered corpus.

No provider call is permitted before recording the prepared-manifest digest here and in the current workstream. Later drift in the CLI, contract, suite, registered corpus, or manifest stops execution and requires new preparation and review.

Prepared manifest: `sha256:740636c9b0435e34a3ee5885e0110f88eeb3f51a9533aceb07142bc0b9aa2f1f`

The bound pilot contains project `prj_4a4422a9ff144d58`, 286 registered Markdown documents, corpus digest `sha256:f7335d801c59f7f32411cb2fa71d8c5872d332f818caf7994bee69bce96c2988`, contract digest `sha256:0432d01c5cf3e78a15bf17dc7500bd4c1973ec1baceb1d38b325427f16760425`, and built CLI digest `sha256:6bc7402c04fa546b41bf9611cd3e483a3b20294249ef4b043d9cb0008d563514`. Its provider-free dry run produced 24 scheduled nonempty projections and four deterministic truncations, exceeding the 10-projection incidence gate before any provider call. The four truncations are the four repetitions of `drv8case_status_node_fleet`; each has 19 link candidates and retains the bounded first eight.

### Run only the pre-registered ordinary managed population

Use the unchanged checked-in public v8 queries for exactly 30 ordinary Codex managed task calls:

- three repetitions of all eight cases, totaling 24 calls; and
- one additional repetition of each of the six `recommendations`-expected cases, totaling six calls.

Each call uses the built CLI, provider `codex`, built-in `developer` role, medium risk, a distinct root-level `pilot-output-NN.md` target, and one target-specific bounded verification suite proving the declared file exists and is nonempty. Distinct targets make identical repeated responses observable as changes. The task request remains the exact public query; the role and declared path carry the write instruction.

Allow at most 30 provider task calls. Do not add grounding, selection, scoring, provider-shadow, retry, repair, or answer-quality calls. Stop at the first managed-run failure, verification failure, missing or unavailable shadow observation, prepared-state drift, privacy failure, or replay mismatch. Preserve partial receipts and observations for diagnosis; never replace a failed sample.

### Review exact production observations

After every successful call, record its ordinal, public case, repetition, run ID, target, verification suite, and immutable observation record ID in an owner-only receipt set. This derived controller state contains no provider result body.

Replay each query through the production registered-corpus lexical index and unchanged `linked-evidence-shadow-v1` projection. For every run, require exact equality of recommendation count; source snapshot; candidate, retained, ignored, truncation, byte-count, and projection digests; and ordered retained document IDs and content hashes. Inspect serialized observation records for query text, absolute pilot paths, registered source paths, and all other forbidden unrestricted values. Explicitly review every truncation, including candidate count, deterministic retained prefix, and byte bound.

The pilot passes only with exactly 30 eligible receipts and observations, at least 10 nonempty projections, zero unavailable observations, zero replay mismatches, and zero privacy failures. Passing proves projection incidence, deterministic replay, bounds, and observation privacy only for this registered population. It does not prove answer quality, provider use, production representativeness, or authority for provider-shadow or canary effects.

## Consequences

This repository retains its empty operational document registry and unchanged managed context. Provider calls are limited to ordinary managed runs needed for eligible phase A observations; linked evidence remains effect-free and never reaches the provider.

A passing review may close ADR-0248's phase A collection gate only for this explicitly limited pilot population. Provider-shadow experiments require a separate reviewed decision covering the extra turn, privacy, cost, cancellation, adapter receipt, and failure contract. E1-E4 context effects require a separate canary decision.

## Observed outcome

Pilot v1 stopped when ordinal 1 returned nonzero. The primary managed execution completed, created only its declared file, passed project verification, emitted `run.completed`, and recorded one private, exactly replayable shadow observation with six retained linked candidates. The production path then performed its mandatory separate Codex semantic writing evaluation. That evaluation failed `plain_audience_language` and `direct_result_and_action`, blocked publication, and caused CLI failure without reverting the verified change.

This revealed an error in the decision's call model: machine presentation does not remove the separate human-publication evaluator required by the execution specification and ADR-0015. Because this decision prohibited an answer-quality call and required stopping on the first nonzero result, ordinals 2 through 30 were not called and the sample was not replaced. See the [pilot v1 observation](../../../evidence/search/linked-evidence-shadow-phase-a-registered-pilot-v1.md).

The prepared incidence result remains valid for the isolated corpus, but pilot v1 does not meet the 30-run phase A gate. Replacement requires a newly reviewed call budget, an eligibility rule for publication-blocked `run.completed` observations, and user authority. This decision does not authorize changing production publication behavior for the experiment.

## Verification

- Validate the contract and exact 30-run schedule with focused tests.
- Before provider execution, prove a nonempty registered corpus, at least 10 scheduled nonempty dry-run projections, clean pilot repository bytes, and exact prepared-manifest read-back.
- During execution, stop after any nonzero managed-run result or non-`observed` record and never exceed 30 calls.
- Replay every immutable observation and review privacy and truncation results.
- Run structural review, `pnpm quality:check`, relevant tests, the complete repository check, knowledge migration and lint, and task-base release completion.

## References

- [ADR-0248: Stage linked-evidence reconciliation activation](../0248-stage-linked-evidence-reconciliation-activation.md)
- [Phase A collection preflight](../../../evidence/search/linked-evidence-shadow-phase-a-preflight.md)
- [Search recommendation and managed-context boundary](../0054-search-recommendation-managed-context-boundary.md)
- [Existing-document adoption](../../knowledge/documents/0018-existing-document-adoption.md)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
