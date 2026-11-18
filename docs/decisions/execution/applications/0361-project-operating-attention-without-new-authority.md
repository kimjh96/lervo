# ADR-0361: Project operating attention without new authority

- Status: accepted
- Date: 2026-09-04

Partially superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md): the product-host discovery part is removed. Lervo no longer ships the product-host protocol or its `operating_attention.inspect` route. `OperatingAttentionReportV1`, direct terminal preparation, and `lervo application attention` stay.

## Context

Lervo stores pending workstream decisions and approvals and exposes canonicalization and knowledge-lifecycle status, but these surfaces were separate. An agent could complete unrelated work while a current user decision, review candidate, or repository maintenance item remained undisclosed until someone ran its owning command.

Making the aggregate a new inbox or acknowledgment store would duplicate canonical state and could falsely imply that prompt preparation proved provider or user receipt. Running the full knowledge lifecycle or another model call for every prompt would worsen direct-hook latency.

## Decision

Add `OperatingAttentionReportV1`, a bounded, provider-neutral, read-only projection over the verified current workstream, canonicalization candidate registry, and knowledge-lifecycle inspection. Each item names its existing action owner and preserves whether user authority is required. Unknown ownership remains `unassigned`; Lervo does not infer approval or assign blockers from prose.

Exclude observation time from the stable report digest. Cap the projection at 256 deduplicated items. A source-read failure produces explicit `unavailable` coverage and keeps the report in `action_required`; it never becomes an empty success.

Direct terminal preparation reuses its current workstream and canonicalization reads and consumes only the exact lifecycle cache. It prepends at most twelve items and performs neither a full lifecycle rescan nor another provider call. The same current projection may be prepared repeatedly until canonical source state changes. Preparation is not evidence of delivery, acknowledgment, understanding, or action.

Expose the complete report as `lervo application attention --json`. Keep product-host protocol v1 and its default discovery command unchanged. Explicit protocol-v2 discovery appends the read-only `operating_attention.inspect` route and the `operating_attention_report` projection.

The projection grants no review, approval, write, provider, scheduling, or external-effect authority. Existing workstream, canonicalization, and lifecycle commands remain the sole owners of their transitions.

## Privacy

Allow bounded workstream questions and approval summaries, repository-relative candidate paths, responsibility classes, candidate hashes, lifecycle issue codes, and prescribed local commands.

Exclude prompt bodies, provider output, credentials, native provider identifiers, absolute paths, hidden reasoning, and inferred acknowledgment.

## Consequences

- Agents and external product hosts receive one current action projection without importing storage packages or creating a product-owned task database.
- User-authority items can be presented proactively while safe maintenance remains separately owned.
- Direct-hook latency does not incur another full lifecycle scan or model call.
- The report cannot resolve an item, prove it was seen, or provide unattended continuation.

## Verification

Projection, command, direct-terminal, protocol-discovery, and packed-consumer tests must cover the new boundary. Existing protocol-v1 discovery must remain byte-for-byte compatible at the contract level.
