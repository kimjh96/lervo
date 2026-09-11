# Worksets and preflight

## Selection

`lervo knowledge normalize --provider codex|claude --scope all-pending|stale` selects a content-bound workset. `all-pending` is the backward-compatible default. `stale` selects only eligible sources with a valid prior reviewed normalization record that is no longer current; new pending sources remain outside that workset.

Every candidate binds repository eligible, current, pending, stale, and unrecorded counts, plus its selected document hashes and bytes. Workset completeness does not establish repository-wide currency.

Repeat `--source <relative-markdown-path>` to select an exact subset within the declared lifecycle scope. Explicit paths must be unique Markdown sources currently in that scope. Invalid selection fails before cache lookup or provider work as `normalization_selection_invalid`.

The workset ID binds selected path, current hash, and byte tuples. Durable event coverage includes only the `explicit_paths` selection kind and aggregate workset coordinates. Exact paths and hashes remain in local preflight and candidate output.

## Preflight and limits

Add `--preflight` to inspect the exact selection without a normalization request or repository write. The local report contains selected paths and hashes, lifecycle disposition, source bytes, envelopes, compiler-bound cache hits and misses, and conservative provider-call capacity. The compiler executable may be probed to bind its descriptor. A cache entry counts as a hit only after ordinary response and no-capability validation succeeds.

Default limits are 1,048,576 selected source bytes and 256 provider calls, overridden with `--max-source-bytes` and `--max-provider-calls`. Optional `--max-observed-tokens` and `--max-elapsed-ms` ceilings are unconfigured by default and appear in preflight without being treated as predicted usage.

Call capacity includes batch fallback. A blocked preflight prevents generation, and execution cannot cross the same call ceiling.

## Resource observations

Codex and Claude translate native normalization usage behind the compiler adapter into neutral input, cached-input, output, and total-token fields. Missing or invalid usage is explicitly unavailable, never zero. Core orchestration aggregates provider-call elapsed time and complete token observations without retaining prompts, document bodies, or native output.

When a token or elapsed-time ceiling is configured, envelopes execute serially; reaching the observed boundary prevents the next call. Unavailable usage under a token ceiling also prevents continuation. A call already in progress is neither predicted nor preempted.

The immediate local generation result carries the resource observation. Candidate identity, candidate storage, approval, lifecycle records, and applied events exclude it. Nondeterministic elapsed time therefore cannot change content identity, and cached results cannot inherit historical usage.

- `normalization_budget_exceeded`: a configured ceiling prevented another provider request.
- `normalization_usage_unavailable`: a declared token ceiling could not safely admit another request because provider usage was unobservable.

## Applied coverage and lifecycle

An applied event includes only the bounded workset identity, scope, counts, and bytes within its coverage. Exact selected paths and hashes remain in local preflight, candidate, and review output, not telemetry. A partial `stale` apply replaces only selected records; lifecycle inspection continues to report unrelated pending sources.

Records bind output and resource hashes plus a user-region hash that excludes managed blocks. Replacement retires older records, and the same transaction refreshes registered rewrite configuration. Post-apply lint failure rolls back. Later byte mismatches become stale and require review.

## Repository layout

Repository document layout follows [ADR-0222](../../decisions/knowledge/repository/0222-bounded-role-based-document-layout.md). One tree evaluator serves planning, lint, and durable permits. Tracked roles locate human documents; provider adapters alone locate provider entrypoints. Bounded rewrite descriptors reconcile byte owners, while unobserved rewrites remain unmanaged.
