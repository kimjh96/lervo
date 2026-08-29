# Deterministic core-and-term repository retrieval v4

Status: `observed_rejected`
Observation date: 2026-08-28

## Question

Can category-independent fixed canonical core coverage plus deterministic per-term lexical bodies remove provider-authored completeness while preserving direct-model retrieval quality, repeatability, and resource bounds?

## Pre-registered decision contract

Core-term-assisted v4 had to:

- pass all three repetitions for at least six of eight cases;
- be non-inferior to contemporaneous model direct in pass count and exact expected-path recall;
- use at most 85% of model-direct observed total tokens and 95% of its wall duration;
- have no worse no-hit p95 duration or latency standard deviation than model direct;
- produce no provider-contract or coverage-contract failures; and
- drop no relevant lexical recommendation, deterministic coverage source, or named no-hit candidate.

Any failure rejected v4. The grounded-answer verdict covers exact expected paths, abstention, preservation, and observable no-hit inspection, but not semantic answer quality or provider understanding. Token usage is a provider observation, not billed cost, and acceptance requires complete observations in both arms.

## Protocol

The benchmark ran `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Eight verification-authored cases and their exact expected paths were unchanged from v3 except for the case-ID prefix. Each arm ran three times per case in independent sessions, producing 48 completed turns with rotating arm order.

V4 received:

- the top three `lexical-v1` bodies;
- a fixed core of `README.md`, `docs/architecture/system.md`, and `docs/specifications/execution.md`; and
- the top lexical body for each of at most eight distinct ASCII query terms.

The same deterministic rule applied to every case. Sources were deduplicated, and 44,773–66,559 bytes of non-lexical bodies were injected. No result field declared the bundle complete.

For lexical no-hits, v4 also received v3's deterministic catalog of all 282 sanitized corpus paths and first headings. The provider had to name one to four candidates and inspect them. The catalog contained no bodies and served as candidate metadata, not evidence.

The English-dominant corpus excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and evaluated search decisions. The accepted run binds:

- suite digest: `sha256:e55721692f28f18d225e4ec29681067a98ca47045bc7f885731297ec569a929d`;
- protocol digest: `sha256:652e7f28eca4d9c822f1b2599e6f0c8135ae04ef7c5d038dff675338d4d768c5`;
- no-hit catalog digest: `sha256:2b08361a8f72429b742f336a20a6ab4cf0aa710cbc26c91f245fbd4b767d1e22`;
- corpus digest: `sha256:02e6554389f2941b9a95aee4c4ec20c73eae7b6f4562719e88ea11d5536c361a`;
- repository revision: `46b36f1a192c3f6e19baa4da5d803900a2a84279`;
- working-tree status digest: `sha256:e6e1d51d51ebc1d56e79f638da286faa4d5e76bfeb945288f0436a8db97adebf`; and
- raw operator-only report digest: `sha256:c84dd5dd32c297114fdaf56c7425928d9e6b979e773`.

The raw report was mode `0600`, stored outside the repository, and moved to recoverable system Trash after this redacted observation was produced. This document contains no source bodies, absolute paths, or answer prose.

## Result

V4 failed five of twelve criteria: repeatability, complete token observation, zero coverage-contract failures, zero dropped relevant deterministic coverage sources, and zero provider-contract failures. It passed pass-count and recall non-inferiority, duration, both no-hit latency criteria, and both other preservation criteria.

| Metric | Model direct | Core-term assisted v4 |
| --- | ---: | ---: |
| Grounded-answer verdicts passing | 15/24 | 16/24 |
| Cases passing all three repetitions | 4/8 | 4/8 |
| Mean expected-path recall | 70.83% | 81.25% |
| Mean returned-path precision | 25.98% | 52.43% |
| Wall duration | 1,148.130 s | 668.979 s |
| Mean duration | 47.839 s | 27.874 s |
| Duration p50 | 47.609 s | 27.612 s |
| Duration p95 | 71.256 s | 37.188 s |
| No-hit duration p50 | 34.910 s | 28.479 s |
| No-hit duration p95 | 47.609 s | 37.188 s |
| No-hit latency standard deviation | 5.766 s | 4.168 s |
| Completed repository commands | 71 | 4 |
| Observed total tokens | 2,906,283 over 23 turns | 1,014,926 over 22 turns |
| Provider-contract failures | 1 | 2 |
| Coverage-contract failures | N/A | 3 |
| Dropped relevant recommendations | N/A | 0 |
| Dropped relevant deterministic sources | N/A | 2 |
| Dropped relevant no-hit candidates | N/A | 0 |

V4 produced one more passing observation, 10.42 percentage points more recall, and 26.46 percentage points more precision. It used 41.73% less wall time, reduced p50 by 42.00% and p95 by 47.81%, issued 94.37% fewer repository commands, improved no-hit p95 by 21.89%, and reduced no-hit latency standard deviation by 27.71%.

The observed token-total ratio was 34.92%, but one direct and two v4 turns lacked usage observations because their structured provider results were invalid. The complete-observation rule therefore rejected the token criterion; incomplete totals cannot establish savings.

## Failure diagnosis

- Ordinary release lookup: v4 passed 2/3 versus direct 3/3. The failed v4 turn omitted `docs/distribution/cli-version-management.md`, which supplied sources linked but deterministic coverage did not include as a body.
- Terse release: v4 passed 0/3 versus direct 1/3. One v4 result was structurally invalid; two returned one of two expected paths and abstained. This is an action-versus-retrieval fixture limitation and source-coverage gap, not evidence that the returned source was wrong.
- Historical hybrid-search rationale: both arms passed 3/3.
- Node-fleet impact: v4 passed 3/3 versus direct 2/3. The fixed core repaired the architecture omission seen in every v3 repetition.
- Fuzzy-merge boundaries: v4 passed 1/3 versus direct 0/3. The exact-merge ADR body was injected in every v4 turn but omitted from returned sources twice, causing both dropped relevant coverage-source failures. Controlled delivery did not prove provider reference or use.
- User-owned-block boundaries: v4 passed 3/3 versus direct 0/3. The fixed execution specification repaired the suite-wide discovery failure observed in v3 and the contemporaneous direct arm.
- First no-hit phrasing: both arms passed 3/3. V4 named, inspected, and returned the exact source every time.
- Second no-hit phrasing: v4 passed 1/3 versus direct 3/3. One v4 turn named the exact candidate without observable inspection; another returned an invalid structured result. Together with the invalid terse result, these caused two provider-contract and three coverage-contract failures.

Fixed core coverage repaired two stable omissions. Term coverage exposed the exact-merge body but did not make the provider cite it repeatably. Machine-side selection, exact loading, hook preparation, provider reference, and unobservable use remain distinct. More supplied bodies are not a completeness contract.

## Decision

Reject core-term-assisted v4 and do not activate it in managed execution. Keep `lexical-v1` operational. Retain the v4 runner, suite, and redacted observation as a reproducible negative baseline.

Any later candidate requires a separately reviewed pre-registration. It must not treat delivery as reference or use, add fixture-specific term limits or fixed sources, relax thresholds, route by question category, infer completeness from confidence, or silently activate managed provider calls. Human-reviewed ground truth remains required before provenance promotion, production-quality claims, or activation.

See [ADR-0241](../../decisions/search/0241-evaluate-deterministic-core-term-coverage-v4.md), the [v3 observation](catalog-assisted-v3.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
