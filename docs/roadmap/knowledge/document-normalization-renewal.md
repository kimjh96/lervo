# Document normalization evidence renewal

Status: `completed`

As of: 2026-09-04

## Objective

Renew stale reviewed-document evidence through bounded, observable provider work without adding unrelated new documents or treating provider output as self-approved knowledge.

The [stale document normalization inventory](../../evidence/quality/stale-document-normalization-inventory-v1.md) identifies 31 lint-visible stale families, separate from 57 newly introduced pending documents at the task-base revision.

## Execution boundary and result

At the inventory boundary, legacy all-pending behavior would have selected 88 documents, 589,372 source bytes, and 45 provider envelopes instead of the reviewed 31-family scope. The implemented `--scope stale --preflight` boundary prevented that widening and reported byte, envelope, cache, call-capacity, observed-token, and elapsed-time evidence before each workset.

The original renewal completed 32 of 33 lint-visible stale families: the 31 inventoried families plus two specifications that later became stale, excluding the release-bound CLI package README. Every applied item was regenerated from its current snapshot and received exact per-source review. A rejected Codex candidate omitted a fleet-shipping responsibility; an independently generated and reviewed Claude candidate preserved it. That fallback used one provider call in 32,224 milliseconds and observed 11,473 input, 3,074 output, and 14,547 total tokens. All other applied final-pass candidates were validated cache hits attributed to zero new calls and tokens.

A later product-outcome convergence run reviewed and applied one current-snapshot Codex candidate covering 85 pending, stale, or unrecorded sources and 636 source units. It produced 87 outputs through 44 provider calls in 2,258,096 milliseconds and observed 663,136 input, 169,600 cached input, 116,337 output, and 779,473 total tokens. Review checked exact source hashes, complete unit coverage, headings, links, URLs, numeric literals, code fences, key product claims, and every per-source approval before application.

That candidate exposed a cross-contract defect: its 4,109-byte CLI guide passed the 12 KiB `human_readme` profile but failed the packed package's 4 KiB limit. ADR-0367 aligned normalization with the smaller contract. A 4,099-byte intermediate candidate remained unapplied; the final 3,998-byte exact candidate used one call in 21,783 milliseconds and observed 12,610 input, 1,022 output, and 13,632 total tokens. Knowledge lint is warning-free, and provider output never authorized its own application.

## Implemented foundation

- `stale` and `all-pending` are content-bound scopes; candidates, plans, receipts, and applied-event coverage distinguish repository coverage from selection coverage.
- Read-only preflight reports exact path, hash, and byte inputs; envelope count; validated cache reuse; compiler coordinates; and byte and call ceilings without making a normalization request.
- Source-byte and conservative provider-call capacity fail before generation; a second call counter operates at the compiler boundary.
- Codex and Claude adapters return provider-neutral token observations. Core aggregates provider-call elapsed time; optional observed-token and elapsed-time ceilings stop continuation before the next envelope.
- Runtime resource observations remain separate from deterministic candidate identity. Cached results are attributed to zero new provider calls.
- Applying a partial stale candidate leaves unrelated new pending documents visible.
- Repeatable explicit source selection binds a review-sized subset within a lifecycle scope without exposing exact paths through applied-event coverage.

## Delivery order

1. Complete the read-only stale-family inventory and bind each family to its reviewed record, matching Git baseline, current delta, and review-breadth class.
2. **Complete.** Add a provider-neutral, content-bound workset that selects `stale` separately from `all-pending`. Preserve repository-wide completion calculation: renewing a partial workset cannot report the whole normalization lifecycle current.
3. **Complete.** Add read-only preflight reporting exact selected paths and hashes, source bytes, envelope count, cache hits and misses for the chosen compiler descriptor, and configured ceilings before normalization.
4. **Complete.** Extend the compiler boundary with observed usage. Provider adapters parse their output; core receives neutral input, output, cached, and total-token fields or explicit `unavailable`. Aggregate usage and elapsed time without retaining prompts or document bodies.
5. **Complete.** Enforce exact workset, input-byte, and conservative provider-call ceilings, then elapsed-time and observed-token ceilings after step 4. Never represent missing usage as zero; stop before the next envelope when a post-call budget is exhausted.
6. **Complete.** Generate separately reviewable worksets for five reference repairs, 17 localized changes, and nine compound changes. Exact path-bounded worksets generated all three groups from validated cache. Isolate the one localized existing-destination conflict from the other 16 sources and replace it with a separate valid Claude fallback candidate. Keep two later stale specification sources in a separate valid workset. Apply no candidate, and keep ignored candidate bytes separate from canonical lifecycle records.
7. **Complete.** Review every source against current bytes and protected material. Apply only exact, content-bound plans with every displayed per-source approval, align the package README profile with its installed 4 KiB contract, refresh structural knowledge, and reach warning-free lint.

## Provider selection

Use Codex initially for the three worksets because all 31 active stale records have Codex provenance; continuity avoids introducing a provider-style variable. This is an operational default, not a quality or correctness claim.

Use Claude only for a failed, invalid, or reviewer-rejected source, or as an explicitly requested shadow candidate for a compound family. Keep both adapters behind the same no-filesystem, no-shell, no-network, no-tool contract. Never infer consensus from overlap or let a fallback candidate inherit approval from the first provider.

## Responsibility boundaries

- Repository knowledge owns workset identity, lifecycle status, partial-versus-repository coverage, exact hashes, and apply authority.
- The process-compiler package owns provider invocation and provider-specific usage parsing.
- The CLI coordinates preflight, progress, and final rendering; it does not implement lifecycle or provider semantics.
- Event and evidence contracts own privacy-bounded usage fields and failure meaning.
- Candidate storage remains ignored local state; Markdown and reviewed lifecycle records remain canonical.

Implementation adds cohesive workset and observation modules instead of placing selection, metering, and rendering branches in the existing command or normalization lifecycle module. Common contract tests cover Codex and Claude with identical core assertions.

## Required state and failure meaning

Specify every new event or state, including required fields and privacy handling, before implementation. Observable outcomes distinguish at least:

| Outcome | Meaning |
| --- | --- |
| `workset_stale` | A selected source, lifecycle status, policy, or compiler coordinate changed before use. |
| `normalization_selection_invalid` | An explicit source path is malformed, duplicated, or outside the selected lifecycle scope. |
| `normalization_budget_exceeded` | A configured byte, call, elapsed-time, or observed-token ceiling prevented another provider call. |
| `normalization_usage_unavailable` | The provider completed without schema-valid usage; no zero-valued measurement is inferred. |
| `candidate_review_required` | Candidate bytes are stored locally, but no user document or lifecycle record changed. |
| `approval_required` | Exact per-source approval is missing or does not bind the current candidate. |

## Completion criteria

- Read-only preflight selects exactly the intended stale workset without invoking a provider.
- Explicit scopes keep unrelated documents outside a `stale` workset unless they independently become stale reviewed families.
- Provider execution cannot exceed declared workset or resource ceilings.
- Final JSON distinguishes measured token usage from unavailable usage and reports cache reuse without attributing cached documents to a new provider call.
- Codex and Claude pass identical workset, no-capability, usage, cancellation, timeout, and over-budget contract tests.
- The five reference-only, 17 localized, and nine compound families remain separately reviewable.
- No family is applied without exact per-source approval; rejection or provider fallback does not authorize sibling families.
- After approved renewal, structural refresh and lint prove all selected records current while preserving later unrelated pending documents as a visible separate backlog.
- Touched production modules pass repository structural review, quality checks, relevant document-lifecycle suites, release completion, `lervo migrate knowledge`, and `lervo knowledge lint`.

## Non-goals

- Automatically rewriting all pending documentation.
- Treating normalization as model learning, truth promotion, or semantic consensus.
- Replacing exact human review with line-count, provider, or token heuristics.
- Combining provider parsing, CLI formatting, and lifecycle authority in one module.
