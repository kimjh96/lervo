# Observable reference-marker repository retrieval v5

Status: `observed_rejected`
Observation date: 2026-08-28

## Question

Can an exact, separately observable output-reference marker for every returned supplied source improve deterministic core-and-term retrieval repeatability without treating delivery as provider reference or use?

## Pre-registered decision contract

Reference-marker-assisted v5 had to:

- pass all three repetitions for at least six of eight cases;
- be non-inferior to contemporaneous model direct in pass count and exact expected-path recall;
- use at most 85% of model-direct observed total tokens and 95% of its wall duration;
- have no worse no-hit p95 duration or latency standard deviation than model direct;
- produce no provider, coverage, or reference-contract failures;
- drop no relevant lexical recommendation, deterministic coverage source, or named no-hit candidate; and
- leave no relevant returned supplied source without its exact output marker.

Any failure rejected v5. A marker proves only that the exact supplied version was referenced in the bounded output. It does not prove attention, semantic reliance, understanding, agreement, correctness, completeness, or internal use. Token usage is a provider observation, not billed cost. Acceptance requires complete observations in both arms.

## Protocol

The benchmark ran `gpt-5.6-sol` through the Codex provider adapter in read-only mode with approvals disabled. Eight verification-authored cases and their exact expected paths were unchanged from v4 except for the case-ID prefix. Each arm ran three times per case in independent sessions, producing 48 completed turns with rotating arm order.

V5 received v4's top-three lexical bodies, fixed canonical core, deterministic per-ASCII-term coverage bodies, and path-title catalog on lexical no-hits. Every returned path backed by a supplied evidence body required its exact `lervo-e4` evidence token as a standalone Markdown HTML comment. Returned supplied paths and observed markers had to be bijective; protocol and catalog markers were forbidden. Known markers were stripped before answer parsing and retained operator output.

The English-dominant corpus excluded benchmark fixtures, search evidence, generated knowledge, the natural-language roadmap, and evaluated search decisions. The accepted run binds:

- suite digest: `sha256:56bb670a45eefbd4e63d631dc68b6620560a0d951e1edf696ef1cd83cac87294`;
- protocol digest: `sha256:4e04987ed68297d3423751a8f9329891721b766576fd2c13c789cc402443c5ef`;
- no-hit catalog digest: `sha256:4bbb1d11d722a1ffe2fa8a534f4560c7f2d506748f22a96629aa0cf9226a93e8`;
- corpus digest: `sha256:ec36519ce7cd82580cab3b8421a327a8b94187d09b5a661a69f741f914e492e3`;
- repository revision: `46b36f1a192c3f6e19baa4da5d803900a2a84279`;
- working-tree status digest: `sha256:9df82a09ead042d29eb207bb011fb26645023765ae172b0b4bb790c6fc64e3ea`; and
- raw operator-only report digest: `sha256:d413021cdfc331020533102f3940b525cd4b29470124cb70892ee137a87816dc`.

The raw report was mode `0600`, stored outside the repository, and moved to recoverable system Trash after this redacted observation was produced. This document contains no source bodies, absolute paths, markers, or answer prose.

## Result

V5 failed eight of thirteen criteria: repeatability, pass-count non-inferiority, recall non-inferiority, complete token observation, zero provider failures, zero coverage failures, zero reference failures, and deterministic-source preservation. It passed duration, both no-hit latency criteria, recommendation and no-hit-candidate preservation, and relevant-returned-source reference.

| Metric | Model direct | Reference-marker assisted v5 |
| --- | ---: | ---: |
| Grounded-answer verdicts passing | 14/24 | 9/24 |
| Cases passing all three repetitions | 3/8 | 2/8 |
| Mean expected-path recall | 79.17% | 54.17% |
| Mean returned-path precision | 30.63% | 40.62% |
| Wall duration | 1,057.702 s | 460.562 s |
| Mean duration | 44.071 s | 19.190 s |
| Duration p50 | 44.251 s | 16.085 s |
| Duration p95 | 69.864 s | 35.323 s |
| No-hit duration p50 | 35.488 s | 13.793 s |
| No-hit duration p95 | 51.794 s | 29.187 s |
| No-hit latency standard deviation | 8.609 s | 5.716 s |
| Completed repository commands | 89 | 1 |
| Observed total tokens | 3,550,780 over 24 turns | 730,564 over 19 turns |
| Provider-contract failures | 0 | 5 |
| Coverage-contract failures | N/A | 5 |
| Reference-contract failures | N/A | 5 |
| Exact output evidence references | N/A | 44 |
| Marker/path mismatches on valid results | N/A | 0 |
| Dropped relevant recommendations | N/A | 0 |
| Dropped relevant deterministic sources | N/A | 4 |
| Dropped relevant no-hit candidates | N/A | 0 |
| Unreferenced relevant returned sources | N/A | 0 |

V5 used 56.46% less wall time, reduced p50 by 63.65% and p95 by 49.44%, improved no-hit p95 by 43.65%, and reduced no-hit latency standard deviation by 33.60%. Its observed token-total ratio was 20.57%, but five v5 turns lacked usage observations because their structured provider results were invalid. The complete-observation rule therefore rejected the token criterion; incomplete totals cannot establish savings.

Valid v5 results satisfied the exact marker/path bijection. The five failed reference contracts came from invalid provider results, not observed marker mismatches. Exact output reconciliation worked when a valid result existed, but did not make the provider reliably produce a valid or complete answer.

## Failure diagnosis

- Ordinary release lookup: v5 passed 0/3 versus direct 3/3. Every v5 result returned only one of two expected sources despite satisfying its marker contract.
- Terse release: both arms passed 0/3. V5 returned one of two expected paths in every repetition; the action-versus-retrieval fixture limitation remains.
- Historical hybrid-search rationale: both arms passed 3/3. Each valid v5 result returned and marked the exact expected source.
- Node-fleet impact: v5 passed 3/3 versus direct 2/3. Fixed core coverage continued to preserve the architecture source.
- Fuzzy-merge boundaries: v5 passed 1/3 versus direct 0/3. It omitted the injected exact-merge ADR in the first two repetitions, causing two dropped relevant coverage-source failures, then returned and marked it in the third.
- User-owned-block boundaries: v5 passed 1/3 versus direct 2/3. It omitted the injected execution specification in the first two repetitions, causing two more deterministic-source preservation failures.
- First no-hit phrasing: v5 produced an invalid structured result in every repetition versus direct 3/3.
- Second no-hit phrasing: v5 passed 1/3 versus direct 1/3. Its second and third results were structurally invalid.

The experiment established two negative findings. Marker reconciliation did not repair known deterministic-source omissions: exact bodies remained delivered but unreturned. The stricter no-hit output protocol also coincided with five invalid structured results. No valid result returned a supplied path without its marker, but observable output reference alone did not improve answer recall or repeatability.

## Decision

Reject reference-marker-assisted v5 and do not activate it in managed execution. Keep `lexical-v1` operational. Retain the v5 runner, suite, and redacted observation as a reproducible negative baseline.

Any later candidate requires a separately reviewed pre-registration and human-reviewed ground truth. It must not treat a marker as understanding or internal use, add fixture-specific term limits or fixed sources, relax thresholds, route by question category, infer completeness from confidence, or silently activate managed provider calls.

See [ADR-0243](../../decisions/search/0243-evaluate-observable-reference-markers-v5.md), the [v4 observation](core-term-assisted-v4.md), and the [natural-language grounding quality roadmap](../../roadmap/natural-language-grounding-quality.md).
