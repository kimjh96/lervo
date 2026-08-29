# ADR-0281: Prepare an exact managed-context canary v2 checkpoint

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0279](0279-stop-managed-context-canary-v1-on-command-signal.md) terminally stopped v1 after its first Codex selection call exposed command execution. V1 has no completed managed-task sample and cannot resume, retry, repair, or replace the failed run.

[ADR-0280](0280-add-an-opt-in-codex-responses-no-tool-transport.md) adds a selection-only Responses transport that can attest tools, command execution, and file changes as unsupported. The Claude SDK arm provides the same provider-neutral boundary through an empty tool list. Neither implementation authorizes provider traffic or supplies a cross-provider measurement.

## Decision

Prepare `benchmarks/search/linked-evidence-managed-canary-v2.json` and one owner-only manifest under `.lervo/state/search/linked-evidence-managed-canary-pilots/`. Preparation is provider-free. The v2 contract begins with zero calls, execution disabled, managed-context effects disabled, and production activation disabled.

Keep the same eight reviewed source tasks and two paired repetitions, totaling 16 task runs: eight Codex and eight Claude. Retain the 32-call ceiling of at most one selection and one ordinary task call per run, with no retries, repairs, fallbacks, or replacements. Preserve the v1 pilot beside v2 by increasing only the shared retention ceiling from one to two pilot directories.

Bind the Codex arm to model `gpt-5.6-sol` and the `responses_api_no_tools` selection transport at the fixed OpenAI Responses endpoint. Its request contract is `tools: []`, `tool_choice: "none"`, `store: false`, a maximum of 512 output tokens, and the exact per-run structured selection schema. Bind the Claude arm to model `opus` and `claude_sdk_no_tools` with an empty tool list.

Bind v1 as a terminal predecessor through its exact prepared-manifest digest, failure-record ID, and failure-record file digest. V2 does not reinterpret v1's preserved 31-call safety budget as speed or cost savings.

The prepared v2 manifest remains ineligible for execution until an operator separately reviews and authorizes its exact digest. The current environment has no `OPENAI_API_KEY`; preparation must not attempt either provider, and live execution remains unavailable here.

## Consequences

The next experiment can be reviewed as a new paired population without erasing or mutating the v1 failure. Transport choice, model identity, task coordinates, schema binding, source evidence, and call ceilings are explicit before provider work.

No speed, accuracy, recall, precision, token, or cost result exists at preparation time. Such a claim requires all 16 v2 runs to satisfy the exact acceptance contract and retain complete E1-E4 evidence. A failed run preserves evidence, restores the policy to default-off, and ends the checkpoint without retry.

## Verification

- Verify the contract digest and exact v1 predecessor bindings.
- Verify eight paired source tasks, eight runs per provider, and the 32-call ceiling.
- Verify the Codex and Claude no-tool transport objects in every matching prepared run.
- Verify the owner-only manifest contains no query text or repository path and remains non-executable with zero provider calls.
- Run focused contract tests, provider-common tests, repository quality and full checks, documentation lifecycle, knowledge migration and lint, and exact-base release completion.

## References

- [V1 stop decision](0279-stop-managed-context-canary-v1-on-command-signal.md)
- [Codex no-tool transport decision](0280-add-an-opt-in-codex-responses-no-tool-transport.md)
- [V1 evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v1.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
- [Natural-language grounding quality roadmap](../../../../roadmap/natural-language-grounding-quality.md)
