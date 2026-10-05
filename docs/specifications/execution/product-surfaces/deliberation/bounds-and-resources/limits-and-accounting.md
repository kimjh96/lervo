# Deliberation limits and accounting

## Authoritative limits

Existing policy rounds, required verification suites, provider selection, writing gates, queue leases, deadlines, output limits, and uncertain-effect reconciliation remain authoritative. Each policy additionally binds `maximumProviderCalls`, `maximumObservedTokens`, `maximumElapsedMs`, and `unobservedTokenDisposition: block`.

Provider calls include stakeholder production, semantic evaluation, bounded repair, verification, and decision turns. Exact normalized `resource.usage.recorded` totals accumulate across these child scopes:

- Reaching the call limit blocks admission.
- Reaching the inclusive observed-token limit after a call blocks publication and every later call.
- Unavailable exact usage blocks with `deliberation_budget_observation_unavailable`.

The elapsed deadline supplies the managed abort signal and remains bound through the approved checkpoint on resume. Before each provider call, the runner subtracts a fixed finalization reserve from remaining workflow time. The Node worker also passes a managed elapsed ceiling ending before its child-process timeout. This reserves bounded time for stream drain, provider stop, post-run snapshot, failed-outcome recording, storage close, and terminal summary serialization.

Budget values and consumed counters contain no prompts, prose, credentials, native payloads, or platform identifiers.

## Call feasibility and snapshot capture

Execution-plan construction rejects a provider-call ceiling insufficient for configured maximum rounds, every reviewer, revision between rounds, every required verification suite, the decision-owner turn, and each required semantic evaluation, even without repair.

With four reviewers, the installed architecture policy requires 24 baseline calls and permits 32 for four bounded writer repairs and their evaluations. The installed ceiling cannot equal a falsely optimistic best case. Feasibility checks prevent provider work under a structurally impossible ceiling; runtime exhaustion remains correct when actual bounded repair or usage consumes the declared allowance.

All managed role and semantic-evaluator runs in a deliberation share one integrity-preserving repository snapshot capture. Capture revalidates directory entries and rereads changed files. Unchanged files reuse identity-bound hashes rather than forcing every child run to rescan their bytes before the same deadline.

Product configuration must be no looser than the selected policy's elapsed ceiling. A mismatch blocks start rather than weakening policy.

## Resource accounting

Each managed role run retains its resource descriptor and `deliberation` causal relationship. Provider input, cached input, output, reasoning output, and total tokens remain grouped by provider, role, run, session, accounting mode, and descriptor hash. Publication evaluation and verification remain separate child scopes. Unlike cache observations are never combined.

Observed tokens are a hard admission and acceptance bound only because current Codex and Claude adapters provide exact normalized resource observations. They do not prove billing or monetary cost. A monetary stop requires a separately versioned accounting contract.

The budget counts only complete (`observed`) usage whose scope matches the run's causal relationship: `deliberation` for role turns and `publication_evaluation` for evaluator turns. Partial, unavailable, or invalid records and usage of another scope in the same run do not count and block with `deliberation_budget_observation_unavailable`. Distinct observations are summed; a repeated observation identity counts once.
