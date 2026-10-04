# Deliberation bounds and resources

## Authoritative limits

Existing policy rounds, required verification suites, provider selection, writing gates, queue leases, deadlines, output limits, and uncertain-effect reconciliation remain authoritative. Each policy additionally binds `maximumProviderCalls`, `maximumObservedTokens`, `maximumElapsedMs`, and `unobservedTokenDisposition: block`.

Provider calls include stakeholder production, semantic evaluation, bounded repair, verification, and decision turns. Exact normalized `resource.usage.recorded` totals accumulate across these child scopes:

- Reaching the call limit blocks admission.
- Reaching the inclusive observed-token limit after a call blocks publication and every later call.
- Unavailable exact usage blocks with `deliberation_budget_observation_unavailable`.

The elapsed deadline supplies the managed abort signal and remains bound through the approved checkpoint on resume. Before each provider call, the runner subtracts a fixed finalization reserve from remaining workflow time. The Node worker also passes a managed elapsed ceiling ending before its child-process timeout. This reserves bounded time for stream drain, provider stop, post-run snapshot, failed-outcome recording, storage close, and terminal summary serialization.

Budget values and consumed counters contain no prompts, prose, credentials, native payloads, or platform identifiers.

## Call feasibility and snapshot capture

Execution-plan construction rejects a provider-call ceiling insufficient for the configured maximum rounds, every reviewer, revision between rounds, every required verification suite, the decision-owner turn, and each required semantic evaluation, even without repair.

With four reviewers, the installed architecture policy requires 24 baseline calls and permits 32 to allow four bounded writer repairs and their evaluations. The installed ceiling cannot equal a falsely optimistic best case. Feasibility checks prevent provider work under a structurally impossible ceiling; runtime exhaustion remains correct when actual bounded repair or usage consumes the declared allowance.

All managed role and semantic-evaluator runs in a deliberation share one integrity-preserving repository snapshot capture. Capture revalidates directory entries and rereads changed files. Unchanged files reuse identity-bound hashes instead of forcing every child run to rescan their bytes before the same deadline.

Product configuration must be no looser than the selected policy's elapsed ceiling. A mismatch blocks start rather than weakening policy.

## Immutable repository evidence

Managed deliberation resolves repository knowledge once, before the first provider starts. It selects bounded current topic-ranked publications, rereads each source under the repository file boundary, verifies its query-returned content hash, and materializes an immutable workspace copy and manifest. The manifest binds query, source snapshot, impact report, source path, concept, and exact source hash.

No current result, changed source, oversized source, invalid bundle, or failed copy records `deliberation_evidence_unavailable` and a terminal failed deliberation with zero provider calls.

Every stakeholder and verifier turn receives the same manifest and exact copies through managed context rules. Writing evaluators receive only their evaluation request and writing policy. Resume restores exact generated evidence bytes from the checkpoint without rerunning retrieval. Selected, loaded, injected, and referenced evidence remain separately observable and are never inferred from the bundle alone.

## Provider capability boundary

Managed deliberation provider turns consume only the exact-hash evidence bundle and prior writing-gated publications injected by Lervo. The application disables provider tools where the native adapter supports that boundary and independently configures every deliberation child run with zero allowed tool calls and zero allowed command executions.

The first observed tool or command event is retained as normal provider telemetry, aborts the active provider session, and records `run.failed` with `provider_tool_limit_exceeded` or `provider_command_limit_exceeded`. These existing failure events require normal run, session, phase, code, retryability, and causal coordinates. They add no prompt, command body, output, document body, credential, or native provider payload. Neither failure is retryable within the deliberation: repeating the same unconstrained behavior would spend the bound again.

## Failure and evaluation recovery

An internally exhausted elapsed budget records a canonical failed outcome; the assigned CLI returns a terminal `failed` summary with exit status 2. The queue settles that summary normally and publishes the language-matched failure consequence, without classifying the known failure as uncertain.

Only outer worker expiry, process loss, or another boundary failure preventing a verified terminal summary remains uncertain exactly once and never reruns provider work. Authoritative inspection continues on the background schedule. Transient inspection, interaction-store, or delivery failure does not terminate the deliberation background loop or discard the pending attention obligation.

Semantic publication evaluation is fail-closed and separately bounded. If its read-only managed child run fails at a retry-safe snapshot or provider boundary, the runner retries the same content-addressed artifact once in a fresh session, recording attempt ordinal two under `publication_evaluation` causality. It does not regenerate the producer artifact. Invalid evaluator contracts, negative check results, capability failures, telemetry failures, and exhausted infrastructure attempts remain publication failures.

## Resource accounting

Each managed role run retains its resource descriptor and `deliberation` causal relationship. Provider input, cached input, output, reasoning output, and total tokens remain grouped by provider, role, run, session, accounting mode, and descriptor hash. Publication evaluation and verification remain separate child scopes. Unlike cache observations are never combined.

Observed tokens are a hard admission and acceptance bound only because current Codex and Claude adapters provide exact normalized resource observations. They do not prove billing or monetary cost. A monetary stop requires a separately versioned accounting contract.

The budget counts only complete (`observed`) usage whose scope matches the run's causal relationship: `deliberation` for role turns and `publication_evaluation` for evaluator turns. Partial, unavailable, or invalid records and usage of another scope in the same run do not count, so they block with `deliberation_budget_observation_unavailable`. Distinct observations are summed; a repeated observation identity counts once.

## Provider-proven participation

Under [ADR-0460](../../../../decisions/coordination/deliberation/0460-trigger-tiered-deliberation-at-decision-points.md), `deliberation.artifact.recorded` carries `usageVerification`. It is `verified` only when the producing run recorded complete `deliberation`-scope usage for the producing provider; otherwise it is `unverified`, and readers treat a historical event without the field as `unverified`. `deliberation.completed` carries `verifiedParticipantCount`, the number of participant roles whose every artifact is verified. The runtime refuses a `converged` outcome while any artifact is unverified and reports `deliberation_participant_unverified`; `no_consensus` and `failed` outcomes still record.

Conversation replies pass the `provider_claim_unproven` check before writing evaluation. A reply that attributes opinions to more than one provider must cite a `dlb_` identifier whose recorded artifacts are all verified and come from at least two providers. Otherwise the reply is repaired, not refused: opinion sentences naming another provider are removed, and a note in the reply language states that the reply reflects the one observed provider. The check covers Discord repository-work replies and managed conversation replies. Provider names include model family names such as Sol and Opus; the events carry only identifiers and verification states.
