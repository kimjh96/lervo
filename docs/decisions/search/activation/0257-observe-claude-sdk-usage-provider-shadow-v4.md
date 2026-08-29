# ADR-0257: Observe Claude SDK usage for provider-shadow v4

Status: `accepted`
Date: 2026-08-29

## Context

[Provider-shadow v3](../../../evidence/search/linked-evidence-provider-shadow-pilot-v3.md) removed Claude tools and added bounded failure diagnostics. Its first Claude turn completed without a tool, command, terminal, result-size, or strict-selection failure, but the common turn rejected it because no usage event was available.

The installed Claude Agent SDK result includes cumulative `modelUsage` for every query-pipeline model call. The Claude adapter discarded that field, emitted no `provider.usage.updated` event, and reported usage as `unknown`. This is an adapter observability gap, not evidence of zero Claude token usage.

## Decision

Normalize the SDK result's cumulative per-model usage into the provider-neutral usage event. Across model rows, sum non-cached input, cache-read input, cache-creation input, and output counts. Report:

- complete input as non-cached plus cache-read plus cache-creation input;
- cache-read input separately;
- output;
- zero reasoning output because the SDK provides no separate reasoning count;
- total as complete input plus output; and
- the maximum reported context window.

Reject malformed or empty usage with the existing bounded provider error. Do not retain SDK cost estimates, model names, or raw provider output.

Advertise Claude usage as `supported`. Run the common adapter contract and focused normalization tests. This compatible bundled correction requires reviewed patch release intent.

Keep v2 and v3 as terminal rejected pilots. Create v4 with 24 fresh samples per provider, fresh `psv4_` coordinates, and the same candidate bytes, models, strict protocol, thresholds, no-effect boundary, empty Claude tool list, and first-failure stop. V4 allows at most 48 calls; the cumulative v2-v4 ceiling is 51. Do not make retries, replacements, repair turns, answer turns, or publication calls.

Passing authorizes only a separate canary-design review. Operational selection, managed context, direct terminals, output, writes, verification, publication, E1-E4 events, canary traffic, and production activation remain unchanged.

## Failure meaning and privacy

`provider.usage.updated` contains the provider turn coordinate, bounded non-negative token counts, and a nullable context-window count. It means the adapter observed SDK-reported cumulative usage; it is not a billing statement.

`invalid_provider_usage` means the SDK result lacked a nonempty, valid model-usage map.

The event excludes cost, model identifiers, prompts, source bodies, output, and provider diagnostics.

## Verification

- Test valid multi-field aggregation and malformed usage rejection in the Claude adapter.
- Run the common adapter contract with usage advertised as supported.
- Preserve the terminal states of v2 and v3, then prepare 48 fresh v4 attempts provider-free.
- Execute v4 once without retry or resumption and run its exact review.
- Publish provider-specific accuracy, duration, observed usage, and candidate compression without a billed-cost claim.
- Run quality, documentation, knowledge, full repository, and task-base release-completion checks.

## References

- [ADR-0256: Correct Claude provider-shadow observability in v3](0256-correct-claude-provider-shadow-observability-v3.md)
- [Provider-shadow v3 evidence](../../../evidence/search/linked-evidence-provider-shadow-pilot-v3.md)
- [CLI version and release management](../../../distribution/cli-version-management.md)
- [Natural-language grounding quality roadmap](../../../roadmap/natural-language-grounding-quality.md)
