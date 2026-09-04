# Terminal direct query projection v1

Status: `quality gate passed; operational hook validation pending`  
Observed: 2026-09-03

## Conclusion

The direct provider-query lifecycle passed the unchanged four-case, five-repetition human-reviewed suite for Codex and Claude on one corpus. All 40 projections completed, reported usage, remained below 20 seconds, and placed every expected Lexical v2 source within rank 10. No case, expected path, rank gate, match policy, repetition, model, query limit, retrieval engine, fusion policy, or privacy exclusion changed.

The lifecycle performs zero pre-observation model turns. It preserves provider capability isolation and performs one query-producing model turn per observation. This report qualifies the exact direct projector builds for product-default retrieval; it does not prove provider acceptance, document injection, internal use, model learning, or whole-task latency.

## Frozen coordinates

- Suite: `spbench_lexical_v2_real_use_reviewed.v1`
- Human-review binding: `sha256:ab432bcd3e9591b7dd94879ca6e8e7a314b4d6c7ae2cead153bf61512667be1d`
- Source snapshot: `ksnap_dc098944e1cd0e0c31e63475`
- Corpus digest: `sha256:6d30dcaaa0840b681ea527a6d161f8e090dbf7bf38156e93abc67b4a9b692a2f`
- Corpus: 514 Markdown documents, 2,235,419 bytes
- Retrieval: Lexical v2, 50 results per projected query, deterministic `query_coverage_interleave`, final reviewed rank 10
- Repetitions: five per case and provider, without retries
- Privacy: request, workstream context, response, provider output, and projected-query text excluded

## Passing populations

| Provider | Direct runtime | Projector build | Result | Maximum projection | Total tokens | Mean tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Codex | `codex.persistent_isolated_thread_direct.v1` | `sqbuild_4567982e194ed62053cdcb25` | 20/20 | 9,666 ms | 233,891 | 11,695 |
| Claude | `claude.serialized_process_direct.v1` | `sqbuild_76f588303e15c0916982d03e` | 20/20 | 5,199 ms | 71,148 | 3,557 |

- Codex report: `lv2real_203461d7bb168523d82810ad`; SHA-256 `sha256:16c2656597765f10f0a4b7b5029126df0e5a7571c94da20697b550b1bee17e54`
- Claude report: `lv2real_e68a4ad6972b656fffece6ca`; SHA-256 `sha256:03bd76e7aa12eee7327924eab7335c842a7c66a864310e3f8e6020b3a23be6ca`

Codex's worst accepted expected-source rank was 9; Claude's was 10. Both provider populations used the same workstream revision, source snapshot, corpus digest, document count, and byte count.

## Admission-removal diagnostic

Before implementation, one privacy-safe Codex diagnostic separated the old lifecycle. The result-free synthetic admission consumed 5,059 milliseconds and 11,185 tokens; the following real projection consumed 6,582 milliseconds and 11,351 tokens. The direct lifecycle removes the former turn. It does not claim the latter provider work is free or locally deterministic.

A v7-direct one-repetition diagnostic and report `lv2real_bd48bad88f9e496a8a0cf082` remain as failed evidence. The first lacked the approved current-workstream anchors. The later population used seven broad workstream references as retrieval anchors and passed only 15 of 20 cases. Neither observation was retried, combined with v8, or used to weaken the gate.

## Boundaries

The report measures provider query projection separately from repository corpus preparation, snapshotting, deterministic retrieval, exact loading, context assembly, provider main-turn latency, and whole-task completion. One diagnostic comparison does not establish a p50, p95, or p99. Current terminal stage evidence and the provider-free foundation performance protocol remain separate operational checks.

## References

- [Direct lifecycle decision](../../../decisions/execution/providers/hooks/0353-remove-redundant-terminal-query-admission.md)
- [Reviewed suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
- [Product-default search](../../../decisions/search/engines/0328-make-qualified-lexical-v2-the-product-default.md)
- [Stage performance contract](../../../specifications/execution/stage-observation-and-performance.md)
