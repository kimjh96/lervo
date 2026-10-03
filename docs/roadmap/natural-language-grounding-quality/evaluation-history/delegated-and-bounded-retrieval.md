# Delegated and bounded retrieval

## Delegated pilot

A same-model [delegated pilot](../../../evidence/search/delegated-retrieval-pilot-v1.md) compared direct read-only exploration with top-three lexical assistance across eight cases:

| Measure | Direct exploration | Lexical assistance |
| --- | --- | --- |
| Cases finding every expected path | 7/8 | 5/8 |
| Repository commands | 38 | 10 |
| Observed tokens | 1,203,427 | 592,630 |

Direct exploration recovered all three Korean-only no-hit probes. Lexical assistance was faster when recommendations existed but missed secondary sources in two multi-source cases despite high provider confidence.

ADR-0226 retired `local-hybrid-v1`, retained `lexical-v1`, and directed evaluation toward bounded no-hit and mandatory-verification fallback.

## Bounded fallback v1

[Bounded fallback v1](../../../evidence/search/bounded-retrieval-fallback-v1.md) was rejected and has no activation authority.

Across 16 observations per arm, direct passed 12, lexical-assisted passed 13, and bounded fallback passed 11. Fallback used 93.33% of direct tokens and took 105.11% of direct duration. It passed both repetitions in five cases, below the minimum of six.

Mandatory verification lost a lexically recommended Node-fleet source twice and completed fuzzy-merge evidence once.
