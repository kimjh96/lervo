# Complete execution pagination and source policy

ADR-0440 separates complete execution pagination from interactive windows and scoped supervision. At WSL sequence 30,282, the legacy complete adapter refuses its byte bound. The paged adapter returns all 18,084 original selected events in two pages:

| Page | Sources | Bytes |
| --- | ---: | ---: |
| 1 | 17,439 | 16,776,933 |
| 2 | 645 | 666,449 |

Ordered digest `sha256:de73e696879a472434bf2f9d7b190123d20c0aad364c2dfde2683d9a1572d231` matches an independent complete-original traversal. No historical event or source identity changed.

Combined read-only policy measurement found 23,313 sources, including 50 verification results; 23,296 included sources totaled 42,327,870 bytes. The 20,000-file policy failed specifically on count.

Reviewed Lervo-only expansion selected 32,768 files, preserving the 1 MiB per-file and 64 MiB aggregate limits, exclusions, product defaults, and foreign project policies. Raw policy hashes:

- Before: `sha256:e431f9153969d6a4246aec2d4694cc02b7c43c9f7dfc9e944b14284a6264fdbb`.
- After: `sha256:4f0f3ec68020c9a2f8419502121735530c9515fe4f393dc7f97c6735efb0dd23`.

Mac applied the transition; WSL later observed exact after-bytes through replication.
