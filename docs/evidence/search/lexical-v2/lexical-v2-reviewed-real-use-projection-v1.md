# Lexical-v2 reviewed real-use projection v1

Status: `retrieval quality passed; operational activation not established`  
Observed: 2026-08-31

## Conclusion

The unchanged four-case human-reviewed suite passed five fresh repetitions for Codex and Claude. A provider-neutral query-projection stage issued independent bounded queries, and deterministic query-coverage fusion ranked the results. Lexical-v2 passed all 40 observations. No case, expected path, maximum rank, match policy, alias, boost, fallback, or failed observation was removed or changed.

This evidence does not activate lexical-v2. The immutable transition selects one deterministic `SearchEnginePort`, but the observed candidate is a complete projection-plus-retrieval-plus-fusion plan. Direct terminal retrieval also uses repository knowledge rather than the selected operational engine. Treating this as a single-engine comparison would omit measured stages and weaken the activation contract.

## Frozen coordinates

- Suite: `spbench_lexical_v2_real_use_reviewed.v1`
- Human-review binding: `sha256:ab432bcd3e9591b7dd94879ca6e8e7a314b4d6c7ae2cead153bf61512667be1d`
- Source snapshot: `ksnap_471a56e5f34e7c088ea3b75b`
- Corpus: 455 Markdown documents, 1,851,497 bytes
- Corpus digest: `sha256:c82f1ed06fe5af9fc06e7dfe3f415baa032bff1b0bb87ffb9919308531f17bb5`
- Retrieval: 50 results per projected query, deterministic query-coverage interleave, final rank checked at 10
- Repetitions: five per case and provider, without retries
- Privacy: request, workstream context, and projected-query text excluded from the report

## Results

| Provider | Projector build | lexical-v1 | lexical-v2 | Projection failures | Maximum projection duration | Mean projection tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Codex | `sqbuild_7744ed4f41d8af659690d07d` | 19/20 | 20/20 | 0 | 14,476 ms | 11,770 |
| Claude | `sqbuild_dcec5b8700b1e6dfa620b02e` | 20/20 | 20/20 | 0 | 9,266 ms | 4,808 |

Every lexical-v2 expected source remained within rank 10; each provider's worst rank was 9. Usage was complete for all 40 projection calls. Total projection usage was 235,398 Codex tokens and 96,150 Claude tokens.

- Codex report: `lv2real_c6b0589ba60941018882cc44`; SHA-256 `sha256:786fcd7dccd4cf32da0366e09cf2eb068c1ebf628e58b558a5fa45df8940dec5`
- Claude report: `lv2real_b7b50e5c8b1af1b4289e6bdf`; SHA-256 `sha256:2ec33c4c0485b2df3dcfa483a2c2c71c8016bbbd36785f96e161fee9dec9b579`

The baseline's 39/40 result is retained. This establishes lexical-v2 non-regression on the reviewed retrieval cases, not that query projection benefits only lexical-v2.

## Efficiency and model experiments

The earlier v20 complete evidence pipeline remains the matched engine-level efficiency evidence. Relative to baseline, lexical-v2 used 79.24% of tokens, 93.22% of duration, and 27.51% of bytes for Codex; Claude used 50.37%, 81.20%, and 27.51%. The real-use report measures projection separately and does not combine unlike denominators into a new end-to-end ratio.

Codex `gpt-5.6-luna` reduced projection tokens by about 12% but caused a rank-13 cross-provider miss and was rejected. Claude Haiku timed out twice and was rejected. A smaller capability-free Claude system prompt retained quality and reduced observed mean projection usage from about 7,223 to 4,808 tokens. Default Codex and Claude models remain selected because lower-cost alternatives did not preserve the quality and failure gates.

## Operational scope

This immutable v1 report proves retrieval quality only for its recorded projector builds and corpus. It cannot establish current operational selection, current-corpus equivalence, rollout readiness, or rollback readiness. Those claims require a separately reviewed, tracked complete-plan bundle and the current immutable activation chain defined by ADR-0321. Inspect plan status and that bundle for current operational evidence rather than inferring it from this historical report.

The deterministic engine comparison cannot replay a provider projection plan by itself. Provider projection, fusion, selected-engine execution, and corpus equivalence remain plan-level responsibilities rather than a manufactured single-engine review.

## References

- [Reviewed suite](../../../../benchmarks/search/lexical-v2-real-use-reviewed-v1.json)
- [V20 confirmation](lexical-v2-activation-confirmation-v20.md)
- [Activation gates](../../../decisions/search/engines/0308-pre-register-lexical-v2-pipeline-activation-gates.md)
- [Plan disposition](../../../decisions/search/engines/0320-qualify-projected-lexical-v2-without-engine-activation.md)
- [Retrieval-plan activation](../../../decisions/search/engines/0321-activate-lexical-v2-through-retrieval-plan-selection.md)
