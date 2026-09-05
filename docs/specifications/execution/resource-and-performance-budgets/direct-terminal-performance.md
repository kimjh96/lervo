# Direct-terminal performance assessment

`lervo terminal budget` is a read-only diagnostic over the versioned terminal coverage report. It neither creates a managed run nor upgrades direct provider work from `unmanaged`.

## Populations and budgets

Successful `total` stage durations are grouped by provider, hook, environment-profile digest, repository profile, and cold state. Profiles must not be combined across these boundaries. Initial budgets require:

- Prompt-preparation p95 at most 15 seconds.
- Stop p95 at most 5 seconds.
- No valid observation reaching the 30-second external ceiling.

The environment-profile digest includes a hook-build digest. A changed measured implementation starts a new population without deleting or relabeling older exhausted evidence. A fresh cohort remains `unobservable` until it reaches the unchanged minimum population.

The default minimum population is 30. Operators may select 1 through 100 for a local assessment; the report always records that policy. A profile below the selected population is `unobservable`. Missing, invalid, or incomplete stage evidence also fails closed.

The command succeeds only when every required profile and configured query threshold passes. Exhausted evidence defaults to `blocked`; unobservable evidence defaults to `escalation_required`. Either disposition may be explicitly stricter.

## Query-usage limits

Optional `--max-query-tokens` compares each exact query-projection receipt separately. Unmanaged terminal receipts lack an accounting descriptor and cannot support a cumulative query group. The report retains `per_context_usage_only` and never presents the result as whole-task usage. Direct provider whole-task usage remains `unsupported` with `unmanaged_provider_usage_unobserved`.

The managed Codex app-server adapter separately observes `thread/tokenUsage/updated` and normalizes its exact provider-turn coordinates. This does not make the direct hook's main turn observable: installed hook input has no usage counter, and Lervo does not join a separate app-server stream to an unmanaged hook session by identifier guesswork.
