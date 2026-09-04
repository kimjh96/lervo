# Document normalization evidence renewal

Status: `planned`

As of: 2026-09-04

## Objective

Renew stale reviewed-document evidence through bounded, observable provider work without mixing
unrelated new documents into the workset or treating provider output as self-approved knowledge.

The starting evidence is the
[stale document normalization inventory](../../evidence/quality/stale-document-normalization-inventory-v1.md):
31 lint-visible stale families are separate from 57 newly introduced pending documents at the
task-base revision.

## Why provider execution is deferred

`lervo knowledge normalize --provider <provider>` currently selects every eligible document without
current evidence. At the inventory boundary that means 88 documents, 589,372 source bytes, and 45
provider envelopes rather than the reviewed 31-family scope. The same command does not expose
normalization-token usage even though the provider subprocess may report it.

Running that command now would be operationally valid but would be the wrong bounded action. It
would widen review and cost without first making either visible. Candidate generation remains
deferred; no user-owned document rewrite is authorized by this roadmap.

## Delivery order

1. Complete the read-only stale-family inventory and bind every family to its reviewed record,
   matching Git baseline, current delta, and review-breadth class.
2. Add a provider-neutral, content-bound normalization workset that can select `stale` separately
   from `all-pending`. Preserve the repository-wide completion calculation: a partial workset may
   renew its records but cannot report the whole normalization lifecycle current.
3. Add a read-only preflight that reports the exact selected paths and hashes, source bytes,
   envelope count, cache hits and misses for the chosen compiler descriptor, and configured
   ceilings before any normalization process starts.
4. Extend the normalization compiler boundary with observed usage. Provider adapters parse their
   own output; core receives neutral input, output, cached, and total-token fields or an explicit
   `unavailable` value. Aggregate usage and elapsed time without retaining prompts or document
   bodies.
5. Enforce exact workset, input-byte, provider-call, elapsed-time, and observed-token ceilings.
   Never represent missing usage as zero, and stop before the next envelope when a post-call budget
   is exhausted.
6. Generate three separately reviewable worksets: five reference repairs, 17 localized changes,
   and nine compound changes. Keep ignored candidate bytes separate from canonical lifecycle
   records.
7. Review every source against its current bytes and protected material. Apply only an exact,
   content-bound plan with every displayed per-source approval; then refresh structural knowledge,
   lint, and replan.

## Provider selection

Use Codex as the initial candidate provider for the three worksets because all 31 active stale
records have Codex provenance and continuity reduces an avoidable provider-style variable. This is
an operational default, not a quality or correctness claim.

Use Claude only for a failed, invalid, or reviewer-rejected source, or as an explicitly requested
shadow candidate for a compound family. Keep both adapters behind the same no-filesystem,
no-shell, no-network, no-tool contract. Never infer consensus from overlap, and never allow a
fallback candidate to inherit approval from the first provider.

## Responsibility boundaries

- Repository knowledge owns workset identity, lifecycle status, partial-versus-repository coverage,
  exact hashes, and apply authority.
- The process-compiler package owns provider invocation and provider-specific usage parsing.
- The CLI command coordinates preflight, progress, and final rendering; it does not implement
  lifecycle or provider semantics.
- Event and evidence contracts own privacy-bounded usage fields and failure meaning.
- Candidate storage remains ignored local state; Markdown and reviewed lifecycle records remain
  canonical.

Implementation should introduce cohesive workset and observation modules instead of adding
selection, metering, and rendering branches to the existing command or normalization lifecycle
module. Common contract tests must cover Codex and Claude with the same core assertions.

## Required state and failure meaning

Before implementation, specify any new event or state with required fields and privacy handling.
At minimum, the observable outcomes must distinguish:

| Outcome                           | Meaning                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `workset_stale`                   | A selected source, lifecycle status, policy, or compiler coordinate changed before use.               |
| `normalization_budget_exceeded`   | A configured byte, call, elapsed-time, or observed-token ceiling prevented another provider call.     |
| `normalization_usage_unavailable` | The provider completed but did not expose schema-valid usage; no zero-valued measurement is inferred. |
| `candidate_review_required`       | Candidate bytes are stored locally but no user document or lifecycle record changed.                  |
| `approval_required`               | Exact per-source approval is missing or does not bind the current candidate.                          |

## Completion criteria

- A read-only preflight selects exactly the intended stale workset without invoking a provider.
- The two documentation artifacts created by the inventory turn and any later new documents remain
  outside a `stale` workset unless they independently become stale reviewed families.
- Provider execution cannot exceed declared workset or resource ceilings.
- Final JSON distinguishes measured token usage from unavailable usage and reports cache reuse
  without attributing cached documents to a new provider call.
- Codex and Claude pass the same workset, no-capability, usage, cancellation, timeout, and
  over-budget contract tests.
- The five reference-only, 17 localized, and nine compound families remain separately reviewable.
- No family is applied without exact per-source approval, and rejection or provider fallback does
  not authorize sibling families.
- After approved renewal, structural refresh and lint prove the selected records current while
  unrelated new pending documents remain visible as a separate backlog.
- Touched production modules pass the repository structural review, quality checks, relevant
  document-lifecycle suites, release completion, `lervo migrate knowledge`, and
  `lervo knowledge lint`.

## Non-goals

- Automatically rewriting all pending documentation.
- Treating normalization as model learning, truth promotion, or semantic consensus.
- Replacing exact human review with line-count, provider, or token heuristics.
- Moving provider parsing, CLI formatting, and lifecycle authority into one module.
