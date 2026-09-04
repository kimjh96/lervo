# Document content normalization

Status: `active`
As of: 2026-09-04

## Contract

After canonical bootstrap, layout, and bridges are current, `migrate knowledge --provider codex|claude` uses the same boundary to return bounded Markdown candidates. Entrypoint adoption, bridge disposition, and prose normalization remain independent.

V1:

- Covers ordinary `.md` files outside generated navigation and `.changes/`.
- Distinguishes README, agent instruction, bridge, portable skill or reference, decision, product, architecture, specification, roadmap, instruction, pull-request template, and general document profiles.
- Excludes release intents and the replace-in-place current release note from provider normalization; they retain release ownership.
- Uses `publication.language`; v1 accepts `en`.

Every input retains an output at its original path. Ordinary splits use a sibling directory named for the source stem. The root README must not create a root-level `README/` tree; durable detail belongs in the semantic documentation hierarchy. Historical continuation documents may use the bounded handoff profile based on content, while the selected active source has already entered the workstream stage.

Normalized documents have one H1, except `.github/PULL_REQUEST_TEMPLATE.md`, which never splits, contains no H1, and starts at H2 because GitHub renders the title. All outputs obey byte and line limits. Bridges remain below 2 KiB and 40 lines.

Coverage maps every source section to one or more declared outputs through complete, document-local integer indexes resolved to content-bound versions. Validation preserves:

- Path-scope frontmatter.
- Lifecycle metadata such as `Status:` and `As of:`.
- Managed blocks and provider imports.
- Agent Skill `name`.
- Fenced examples and links in skills and instructions.
- Portable inline coordinates.

Outputs end with exactly one newline. Newly introduced trailing spaces, tabs, or blank lines are rejected. Exact source lines may retain required trailing whitespace only through protected material. Root README routes agents to `AGENTS.md`; wiki links become portable Markdown. Skill descriptions may be localized without changing identity. Canonical instruction frontmatter remains exact. Further condensation requires exact human review. Skill resource hashes bind lifecycle and approval; scripts and assets are not rewritten.

Candidates and shard responses remain ignored local state. Cache identity binds the envelope and compiler build. Plans bind exact candidate bytes and require per-source approval. Apply never reruns the provider: it writes candidates and sharded lifecycle records through the journal, then emits `knowledge.materialization.applied` with `operation=normalize_documents`.

## Worksets and preflight

`lervo knowledge normalize --provider codex|claude --scope all-pending|stale` selects a content-bound workset. `all-pending` is the backward-compatible default. `stale` selects only eligible sources with a valid prior reviewed normalization record that is no longer current; new pending sources remain outside that workset.

Every candidate binds repository eligible, current, pending, stale, and unrecorded counts, plus its selected document hashes and bytes. Workset completeness does not establish repository-wide currency.

Repeat `--source <relative-markdown-path>` to select an exact subset within the declared lifecycle scope. Explicit paths must be unique Markdown sources currently in that scope. Invalid selection fails before cache lookup or provider work as `normalization_selection_invalid`.

The workset ID binds selected path, current hash, and byte tuples. Durable event coverage includes only the `explicit_paths` selection kind and aggregate workset coordinates. Exact paths and hashes remain in local preflight and candidate output.

Add `--preflight` to inspect the exact selection without a normalization request or repository write. The local report contains selected paths and hashes, lifecycle disposition, source bytes, envelopes, compiler-bound cache hits and misses, and conservative provider-call capacity. The compiler executable may be probed to bind its descriptor. A cache entry counts as a hit only after ordinary response and no-capability validation succeeds.

Default limits are 1,048,576 selected source bytes and 256 provider calls. Override them with `--max-source-bytes` and `--max-provider-calls`. Optional `--max-observed-tokens` and `--max-elapsed-ms` ceilings are unconfigured by default and appear in preflight without being treated as predicted usage. Call capacity includes batch fallback. A blocked preflight prevents generation, and execution cannot cross the same call ceiling.

Codex and Claude translate native normalization usage behind the compiler adapter into neutral input, cached-input, output, and total-token fields. Missing or invalid usage is explicitly unavailable, never zero. Core orchestration aggregates provider-call elapsed time and complete token observations without retaining prompts, document bodies, or native output.

When a token or elapsed-time ceiling is configured, envelopes execute serially, and reaching the observed boundary prevents the next call. Unavailable usage under a token ceiling also prevents continuation. A call already in progress is neither predicted nor preempted.

The immediate local generation result carries the resource observation. Candidate identity, candidate storage, approval, lifecycle records, and applied events exclude it, so nondeterministic elapsed time cannot change content identity and cached results cannot inherit historical usage.

- `normalization_budget_exceeded` means a configured ceiling prevented another provider request.
- `normalization_usage_unavailable` means a declared token ceiling could not safely admit another request because provider usage was unobservable.

An applied event includes only the bounded workset identity, scope, counts, and bytes within its coverage. Exact selected paths and hashes remain in local preflight, candidate, and review output, not telemetry. A partial `stale` apply replaces only selected records; lifecycle inspection continues to report unrelated pending sources.

Records bind output and resource hashes plus a user-region hash that excludes managed blocks. Replacement retires older records, and the same transaction refreshes registered rewrite configuration. Post-apply lint failure rolls back. Later byte mismatches become stale and require review.

Repository document layout follows [ADR-0222](../decisions/knowledge/repository/0222-bounded-role-based-document-layout.md). One tree evaluator serves planning, lint, and durable permits. Tracked roles locate human documents; provider adapters alone locate provider entrypoints. Bounded rewrite descriptors reconcile byte owners, while unobserved rewrites remain unmanaged.

## References

- [Repository knowledge compilation](repository-knowledge-compilation.md)
- [Reviewed document content normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Bound document normalization worksets and preflight](../decisions/knowledge/documents/0358-bound-document-normalization-worksets-and-preflight.md)
- [Observed document normalization resources](../decisions/knowledge/documents/0359-observe-document-normalization-resources.md)
- [Explicit document normalization selection](../decisions/knowledge/documents/0360-bind-explicit-document-normalization-selection.md)
- [Bounded role-based document layout](../decisions/knowledge/repository/0222-bounded-role-based-document-layout.md)
