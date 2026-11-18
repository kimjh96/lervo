# Product-host source-current dogfood v1

Status: `observed; historical population remains blocked`

As of: 2026-09-03

## Scope

This observation exercised the built CLI's unmanaged Codex terminal hook in the Lervo repository with two Korean natural-language requests relevant to a future product host. It tested current repository retrieval, exact loaded-document coordinates, query-projection token visibility, and prompt/Stop stage timing. A separate packed external-consumer smoke exercised the version 0.9.0 product-host protocol. Neither path authorized npm, GitHub, Hub, connector, credential, or product mutation.

Raw prompts and provider output are not stored here. Retained evidence includes scenario summaries, opaque request and event digests, bounded usage, selected current paths, and stage aggregates. Selected publications have `unreviewed` assurance. Their apparent usefulness is a task-scoped agent inspection, not human-reviewed ground truth or proof that the provider accepted, understood, relied on, or correctly used them.

## Environment and source

- Provider: `codex`
- Execution mode: `unmanaged`
- Environment profile: `sha256:d14239167d5df47a8b554ecd1e9793eee6eb4dc34df49a987de62e1a7d8fbede`
- Knowledge source snapshot: `ksnap_48ee443f5330c700515ea27d`
- Hook budgets: prompt p95 15,000 ms; Stop p95 5,000 ms; maximum 30,000 ms
- Whole-task provider usage: unavailable with `unmanaged_provider_usage_unobserved`
- Query-projection usage: partial per-context evidence with `accounting_descriptor_unavailable`

## Observations

| Scenario | Context event | Exact loaded current publications | Query-projection tokens | Prompt total | Stop total | Stop lifecycle |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Product-host boundary and replaceable Prime Agent/Hermes edges | `evt_6e2cb1122950494295e78b5a6cb5e596` | `docs/research/lervo-product-positioning-and-verified-improvement.md`; `docs/specifications/execution/events-and-privacy.md` | 11,872 | 11,850.657 ms | 6,210.693 ms | 6,101.783 ms |
| Retrieval/use evidence plus token and hook observability | `evt_09724cf97e294184817f206bf66160cd` | `docs/roadmap/natural-language-grounding-quality.md`; `docs/roadmap/governed-loop-assignment-graph.md` | 11,793 | 11,487.888 ms | 1,574.571 ms | 1,467.189 ms |

The first scenario loaded the canonical research statement that Paperclip and Buzz may sit above Lervo while Prime Agent and Hermes may sit behind provider or execution adapters without becoming required dependencies. The second loaded the roadmap that separates selected, loaded, injected, referenced, and used evidence and records historical token comparisons. These are useful current sources for the summarized intents, but no relevance ratio is computed because the cases lack approved human ground truth.

Both prompt observations were individually below the prompt budget. The first Stop followed an invalidated lifecycle projection and exceeded the Stop budget. After exact source-bound projection creation, the repeated exact-state Stop was below budget. The telemetry profile reports cache state as `unknown`, so this sequence is operational context, not a measured cold/warm cohort.

## Population interpretation

The one-report diagnostic ending at the second scenario returned `passed`, with prompt p95 11,487.888 ms and Stop p95 1,574.571 ms. With one sample per hook, this is a smoke observation, not evidence of population p95 compliance.

The latest 20-report view remains `blocked`: 17 prompt samples with p95 18,563.947 ms, 15 Stop samples with p95 21,330.653 ms, and one incomplete hook pair. Historical observations remain retained and are not rewritten or reclassified by the new result. A fresh source-current population of at least 30 complete observations is required before claiming that the operational p95 gate passes.

## Evidence meaning

- Candidate discovery and exact loading were observed only inside the hook.
- Provider acceptance and managed delivery are unsupported for this unmanaged path.
- Neither synthetic completion message contained an exact output-reference marker.
- Internal model use, correctness, learning, and whole-task token usage remain unsupported.
- Query token counts cover only the isolated query-projection call; they are neither billing nor whole-request totals.
- `action_required` lifecycle status reflected current structural refresh and document-normalization findings, while root completion remained `allowed` under the unmanaged availability contract.

## Reproduction

Use the built CLI and privacy-bounded local events:

```bash
node apps/cli/dist/bin.js terminal coverage --provider codex --limit 2 --json
node apps/cli/dist/bin.js terminal budget --provider codex --limit 1 --minimum-samples 1 --json
node apps/cli/dist/bin.js terminal budget --provider codex --limit 20 --minimum-samples 1 --json
```

The first command reproduces exact event-bound measurements while the local event-retention window contains these coordinates. The other commands intentionally contrast a latest smoke sample with the retained historical population.

## Packed consumer verification

`pnpm smoke:packed-cli` built the real `@lervo/cli` 0.9.0 tarball, installed it in an empty temporary consumer, verified all 21 product-host routes—10 workforce, 7 operating, and 4 collaboration—and completed the local CLI-only host journey without installing a workspace-private Lervo package. It also verified the native Claude runtime artifact. This proves packed protocol and installation behavior, not an external product UI, managed provider task, connector delivery, or publication.

## References

- [Execution stage observation and performance](../../specifications/execution/stage-observation-and-performance.md)
- [Exact terminal lifecycle reuse](../../decisions/operations/trace/0356-reuse-exact-terminal-knowledge-lifecycle-inspections.md)
- [Scope-complete resource and terminal budgets](../../decisions/operations/trace/0354-enforce-scope-complete-resource-and-terminal-budgets.md)
- Product-host protocol specification, removed by [ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md)
