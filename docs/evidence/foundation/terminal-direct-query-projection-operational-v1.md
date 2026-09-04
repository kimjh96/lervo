# Terminal direct query projection operational v1

Status: `passed`  
Observed: 2026-09-03

## Conclusion

The regenerated self-contained Codex `UserPromptSubmit` runtime completed on the Lervo repository with a prepared-context receipt and complete catalog version 2 stage evidence. Compared with the preceding admitted lifecycle observation on the same repository, the Lervo-owned total fell 18.5 percent and the provider query stage fell 23.2 percent.

This single matched operational observation is not a latency percentile. It proves that the new path completed and removed one provider model turn; it does not establish p50, p95, p99, main-provider latency, model attention, document use, or whole-task completion.

## Runtime coordinates

- Runtime contract: `lervo_terminal_hooks_v2`
- Runtime content hash: `sha256:7c219db048b2c952748be89e18d69ed1cbeec59fdb29f13bdf6a5db02837d4e8`
- Runtime bytes: 2,757,280
- Product qualification: `spqual_18bb11bf0b6a01f9a33190bc`
- Retrieval plan: `srplan_317d592259ccbf6029f534f5`
- Projector: `sqbuild_4567982e194ed62053cdcb25`
- Source snapshot: `ksnap_c3848677735f64609ce561c7`
- Context event: `evt_b4464529e0714074a2e1a427c3302998`
- Stage observation: `stgobs_c04657d6269f408b91de0900`
- Privacy: prompt, context, projected-query text, response, provider output, reasoning, configuration, credentials, and absolute paths excluded from retained evidence

## Matched stage comparison

| Measurement | Admitted lifecycle | Direct lifecycle | Change |
| --- | ---: | ---: | ---: |
| Lervo stage total | 18,563.947 ms | 15,137.624 ms | -3,426.323 ms (-18.5%) |
| Provider query stage | 14,526.218 ms | 11,156.418 ms | -3,369.800 ms (-23.2%) |
| Corpus preparation | 1,861.995 ms | 1,730.737 ms | -131.258 ms |
| Repository snapshot | 709.298 ms | 717.196 ms | +7.898 ms |
| Search | 1,338.969 ms | 1,412.175 ms | +73.206 ms |

External wall time for the direct generated-runtime process was 15.51 seconds. The stage total excludes process startup outside the recorder and remains the canonical Lervo-owned duration for this comparison.

## Token-accounting correction

The admitted observation's terminal coverage reported 11,731 query-projection tokens, but its receipt covered only the query-producing turn. A separate privacy-safe lifecycle diagnostic measured the preceding result-free admission at 11,185 tokens. The admitted hook therefore used about 22,916 provider tokens across two model turns; the prior terminal resource projection was partial and did not expose admission usage.

The direct observation reported 11,744 tokens. Because direct preparation performs zero pre-observation model turns, this receipt covers the only provider model turn inside query projection. Compared with the decomposed admitted diagnostic, the direct lifecycle removed about 11,172 tokens, or 48.8 percent. Provider caching and nondeterminism make this single comparison diagnostic rather than billing or population evidence.

## Correctness and failure meaning

The current resolver verified immutable local history, recognized prior product plan `srplan_db810188acfc08abd0b5bd4a` as a declared superseded plan, and selected current product qualification `spqual_18bb11bf0b6a01f9a33190bc`. No history was deleted, and no explicit baseline rollback was overridden.

The hook prepared three exact-hash current documents and recorded catalog version 2 stage `query_projection`. This proves only hook-side preparation. Provider context acceptance and internal use remain unsupported; whole-task provider usage remains unavailable.

## References

- [Direct lifecycle decision](../../decisions/execution/providers/hooks/0353-remove-redundant-terminal-query-admission.md)
- [Direct projector quality evidence](../search/lexical-v2/terminal-direct-query-projection-v1.md)
- [Stage performance contract](../../specifications/execution/stage-observation-and-performance.md)
