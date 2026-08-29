# ADR-0256: Correct Claude provider-shadow observability in v3

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0255](0255-authorize-paired-codex-claude-provider-shadow-v2.md) authorized an exact paired experiment. Provider-shadow v2 stopped after the required two calls. Codex returned a valid selection. Claude accepted identical candidate bytes and completed its turn, but the common boundary recorded `provider_shadow_result_invalid` and produced an unavailable observation. The aggregate code did not distinguish tool completion, terminal state, result size, or strict-selection parsing failures.

The v2 Claude adapter declared `Read`, `Glob`, and `Grep` despite the protocol prohibiting repository inspection. Because the raw result was intentionally not retained, the exact cause cannot be reconstructed. The user required measurements from Codex and Claude and completion without another decision wait.

## Decision

Keep v2 stopped and rejected. Do not resume it, retry either sample, reuse its result, or borrow any coordinate.

Create a fresh paired v3 population using the same 24 source samples, candidate bytes, human-reviewed truth, strict E4-only output protocol, models, acceptance thresholds, and no-effect boundary. Use fresh `psv3_` provider-specific coordinates. Run Claude first for the first source sample, then alternate the starting provider to bound order bias.

Expose no tools to Claude, matching the provider-neutral protocol instead of relying on abstention from declared read tools. Retain plan permission mode and the managed-write denial bridge.

Replace the aggregate post-turn result failure with bounded, raw-free codes for invalid terminal state, tool or command activity, oversized result, invalid strict selection, and missing usage. Never retain or publish the raw provider result. These diagnostic codes do not relax the protocol.

V3 allows at most 24 Codex and 24 Claude calls, with no retry, replacement, repair, answer, or publication turn. Including the two completed v2 calls, the cumulative ceiling is 50. Stop both v3 arms at the first unavailable sample.

Each provider must independently pass all 24 observations. Passing authorizes only a separate canary-design review. Managed context, operational search, direct terminals, writes, output, verification, publication, E1-E4 events, canary traffic, and production activation remain unchanged.

## Release impact

The contract and harness remain repository tooling outside the packed CLI dependency closure. The task-base release-completion check must prove that no new release intent is required.

## Verification

- Prove v2 is terminal and retained before preparing v3.
- After provider-free tests, bind the exact v3 contract digest and execution workstream.
- Reconstruct 24 samples and 48 fresh paired attempts with identical within-pair request and candidate-envelope digests.
- Test every bounded failure code with fake Codex and Claude adapters.
- Prove Claude receives an empty tool list.
- Execute v3 once without resumption, then publish provider-specific accuracy, duration, observed tokens, and candidate-to-selection compression.
- Run repository quality, documentation, knowledge, full test, and task-base release-completion checks.

## References

- [ADR-0255: Authorize paired Codex-Claude provider-shadow v2](0255-authorize-paired-codex-claude-provider-shadow-v2.md)
- [Provider-shadow v2 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v2.md)
- [Human-reviewed linked-evidence v8 suite](../../../../benchmarks/search/linked-evidence-reconciliation-v8.json)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
