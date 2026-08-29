# Provider measurements

| Provider and eligible evidence | Samples | Mean duration | Recall | Mean precision | Mean total tokens | Body-byte reduction | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Codex v2, eight-source maximum | 1 | 11.438 s | 100% | 100% | 42,902 | 90.28% | Eligible; pilot stopped on following Claude arm |
| Claude v7, eight-source maximum | 3 | 45.078 s | 100% | 52.22% | 42,951 | 77.37% | Failed precision |
| Claude v8, two-source maximum | 3 | 39.662 s | 50% | 50% | 60,493 | 84.59% | Failed recall and precision |
| Codex v9, minimal-sufficient | 6 | 8.625 s | 66.67% | 75% | 44,171 | 90.59% | Failed recall |
| Claude v9, minimal-sufficient | 6 | 41.274 s | 83.33% | 72.22% | 52,470 | 82.30% | Failed recall and per-case precision |
| Codex v10, unambiguous minimal-sufficient | 16 | 8.100 s | 81.25% | 97.92% | 42,310 | 91.84% | Failed recall |
| Claude v10, unambiguous minimal-sufficient | 16 | 37.527 s | 100% | 89.58% | 50,709 | 89.00% | Passed |
| Codex v11, claim coverage before minimization | 8 | 11.381 s | 100% | 87.50% | 39,183 | 87.85% | Passed diagnostic |
| Claude v11, claim coverage before minimization | 8 | 41.546 s | 100% | 83.34% | 37,006 | 87.16% | Passed diagnostic |
| Codex v12, partial four-case confirmation | 8 valid, 1 unavailable | 15.611 s | 100% on valid | 70.84% | 40,929 | Not comparable | Failed invalid result |
| Claude v12, partial four-case confirmation | 8 valid | 49.271 s | 100% on valid | 64.59% | 39,708 | Not comparable | Incomplete |
| Codex v13, diagnostic four-case confirmation | 16 | 11.013 s | 100% | 86.46% | 42,507 | 88.17% | Passed |
| Claude v13, diagnostic four-case confirmation | 16 | 45.503 s | 100% | 75.42% | 45,047 | 84.55% | Failed 40% per-observation precision |
| Codex v14, request-scoped two-case diagnostic | 7 valid, 1 unavailable | 14.978 s | 100% on valid | 100% on valid | 42,860 | 91.24% | Failed carrier prose result |
| Claude v14, request-scoped two-case diagnostic | 8 | 47.442 s | 100% | 68.75% | 47,992 | 82.11% | Passed provider gates |
| Codex v16, compatible structured-carrier diagnostic | 8 | 13.754 s | 93.75% | 100% | 43,589 | 91.71% | Failed one recall observation |
| Claude v16, compatible structured-carrier diagnostic | 8 | 39.667 s | 100% | 79.17% | 42,398 | 86.85% | Passed provider gates |
| Codex v17, relational-coverage diagnostic | 8 | 14.990 s | 100% | 95.83% | 43,657 | 90.82% | Passed |
| Claude v17, relational-coverage diagnostic | 8 | 44.510 s | 100% | 79.17% | 42,907 | 86.85% | Passed |
| Codex v18, four-case relational confirmation | 16 | 12.066 s | 100% | 93.75% | 43,492 | 89.57% | Passed |
| Claude v18, four-case relational confirmation | 16 | 46.109 s | 100% | 76.04% | 46,103 | 86.57% | Passed |

Provider-reported token estimates are not directly comparable. Body-byte reduction measures candidate bytes not loaded after selection, not token or billed-cost savings.
