# Delegated repository retrieval pilot v1

Status: `observed`
Observation date: 2026-08-27

## Question

Can direct model exploration answer practical repository questions more reliably than `lexical-v1` recommendations, and at what latency and provider-usage cost?

## Protocol

The benchmark ran `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Both arms used the same sanitized repository snapshot and tools:

- `model_direct`: protocol followed by model-directed repository inspection.
- `lexical_assisted`: the same protocol and tools plus the top three `lexical-v1` documents.

Eight public cases covered task start, historical rationale, status and impact, and approval or ownership boundaries. Three Korean-only variants had previously produced no lexical hits. Arm order alternated by case. Each arm ran once, making this a bounded engineering pilot rather than a statistical quality claim.

The model returned a structured answer and repository-relative source paths. Exact expected-path coverage determined the verdict. Extra supporting paths were recorded but were not false claims. Answers remain operator-only; this durable observation excludes source bodies, answer text, absolute paths, and judge rationale.

The sanitized corpus contained 263 Markdown sources and excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and candidate decisions under evaluation to prevent leakage. The accepted run binds:

- executed suite digest: `sha256:e3a367f295e101affa218bf12069d0e48d75804d66242b7847cb0ba3f5298e28`;
- corpus digest: `sha256:2a98791084cba8c1318fcf1a01d15836cd179bb075fcd92047af6b98633fa7eb`;
- repository base: `bd8f5c7c994078558c6bfc2de2decbdf0463c960`;
- raw operator-only report digest: `sha256:8c3fce6a24ea3ce1c660e566a994668dacbee444fff15f82428a09ee1e6346ac`.

An earlier preflight accidentally used the empty registered-document corpus. The empty corpus digest and recommendation lists exposed the error; that run was discarded and is not part of this observation.

After this observation, the checked-in suite added ADR-0226 and later ADR-0227 to its self-exclusion list and acquired digest `sha256:6daa021a84f0d9ae95b3f8e6889ff53c7426b6c52216704d66dc6d22dde4a82b`. Neither decision existed during execution, so only the suite source digest changed; the effective 263-document corpus, cases, queries, recommendations, and verdicts did not.

## Result

| Metric | Model direct | Lexical assisted |
| --- | ---: | ---: |
| Cases with every expected path | 7/8 | 5/8 |
| Mean expected-path recall | 87.50% | 75.00% |
| Wall duration | 438.786 s | 335.949 s |
| Completed repository commands | 38 | 10 |
| Observed input tokens | 1,191,024 | 583,868 |
| Observed cached input tokens | 908,800 | 389,120 |
| Observed output tokens | 12,403 | 8,762 |
| Observed total tokens | 1,203,427 | 592,630 |

Total token usage is not billed cost. Cache pricing and provider-specific accounting are outside this report.

Among the five cases with lexical recommendations, direct exploration passed 4/5 and recovered 6/7 expected paths. Lexical assistance passed 2/5 and recovered 4/7. Assisted execution used no additional repository commands, 151.545 seconds, and 129,318 total tokens; direct exploration used 32 commands, 308.712 seconds, and 921,236 total tokens.

The assisted arm missed `docs/architecture/system.md` for the Node-fleet impact question and `docs/decisions/execution/providers/0187-review-gated-cross-provider-exact-merge.md` for the fuzzy-merge boundary. Both answers were substantively plausible and marked high confidence, showing that provider confidence and a relevant top-three hit do not establish source completeness. Both arms missed `docs/specifications/execution.md` for the user-owned-block case while correctly deriving the invariant from other canonical sources.

For the three no-hit Korean rationale variants, both arms recovered the expected structured-workstream ADR every time. Because the assisted arm received no recommendations, the differences between 130.074 and 184.404 seconds and between 282,191 and 463,312 total tokens are ordinary single-run model variation, not a lexical effect.

## Interpretation

Direct exploration closed the observed cross-language no-hit gap and was more complete overall, but globally replacing lexical retrieval would materially increase and destabilize repository inspection and provider usage. Lexical recommendations sharply reduced work when sufficiently contextual, but also anchored the model into stopping before secondary-source verification.

The next candidate is neither another sparse-hash hybrid nor unconditional model delegation. It is a bounded fallback: try lexical recommendations first, use direct exploration for no hits, and require verification for multi-source, impact, or approval-boundary questions. Production use requires repeated trials and explicit failure semantics.

See [ADR-0226](../../decisions/search/0226-retire-local-hybrid-and-evaluate-bounded-model-fallback.md) and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
