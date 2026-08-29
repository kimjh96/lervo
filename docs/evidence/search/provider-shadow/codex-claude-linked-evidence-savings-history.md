# Savings and avoided work

The pilots made 202 provider calls across v2-v18 against a cumulative authorized ceiling of 283. The 81 unmade calls were 28.62% of the ceiling and are the defensible experiment-cost saving.

| Observation | Retained/candidate bytes | Reduction and result |
| --- | ---: | --- |
| Codex v2 | 9,427/97,037 | 90.28% |
| Claude v7 | 64,438/284,723 | 77.37% |
| Claude v8 | 49,268/319,657 | 84.59%; recall failed |
| Codex v9 | 56,854/604,380 | 90.59%; recall failed |
| Claude v9 | 106,946/604,380 | 82.30%; recall failed |
| Codex v10 | 120,927/1,482,580 | 91.84%; recall failed |
| Claude v10 | 163,135/1,482,580 | 89.00%; 100% recall |
| Codex v11 | 75,745/623,180 | 87.85%; 100% recall |
| Claude v11 | 80,024/623,180 | 87.16%; 100% recall |
| Codex v13 | 175,426/1,482,580 | 88.17%; 100% recall |
| Claude v13 | 229,067/1,482,580 | 84.55%; 100% recall, one precision-gate failure |
| Codex v14 | 56,608/645,914 | 91.24%; 100% recall on seven valid observations, eighth unavailable |
| Claude v14 | 130,924/731,836 | 82.11%; 100% recall and passing provider gates |
| Codex v16 | 60,694/731,836 | 91.71%; one recall observation failed |
| Claude v16 | 96,214/731,836 | 86.85%; 100% recall and passing provider gates |
| Codex v17 | 67,187/731,836 | 90.82%; 100% recall and passing provider gates |
| Claude v17 | 96,214/731,836 | 86.85%; 100% recall and passing provider gates |
| Codex v18 | 154,577/1,482,580 | 89.57%; 100% recall and passing provider gates |
| Claude v18 | 199,152/1,482,580 | 86.57%; 100% recall and passing provider gates |

V12 byte ratios are excluded because the Codex denominator includes an unavailable observation while selected bytes include only valid results. No billed-cost saving is claimed: SDK usage is not billing data, and no eligible end-to-end baseline measured avoided downstream answer tokens.
