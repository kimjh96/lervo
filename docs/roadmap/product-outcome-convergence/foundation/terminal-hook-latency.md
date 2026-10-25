# Terminal hook latency

Outcome: terminal hooks meet reviewed latency budgets.

State: `implemented`.

The current Codex hook build passed a fresh fixed-request cohort of 30 complete Prompt/Stop pairs. Prompt p95 was 13,937.214 ms; Stop p95 was 1,942.938 ms. Both maxima were below 30 seconds.

Query projection runs concurrently with corpus preparation and repository snapshotting. Project and publication-language coordinates are checked before any result is used. Earlier failed and passing profiles remain retained. A 100-report view still blocks on the preceding build's p95 exhaustion; per-context token exhaustion also blocks at the inclusive configured boundary.

See [terminal hook latency requalification v2](../../../evidence/foundation/terminal-hook-latency-requalification-v2.md).

Ongoing proof: keep profile-separated 30-sample operational evidence current after material hook changes. A monetary cost budget remains unavailable until an accounting and price coordinate is observable.

ADR-0531 changes the shared hook path to compact-by-default preparation with retained opt-in retrieval, a 15-second command budget, a 7.5-second snapshot deadline, closed reasons, and base-context reads only after failure (at most 2.5 seconds within the remaining budget). The earlier retrieval cohort above does not qualify these new bytes. Re-run focused tests after the owner permits them, then measure at least 30 installed Prompt/Stop pairs per provider on a large repository, including snapshot and Git-discovery failure cases, retrieval deadline degradation, capture failure before worker isolation checks, and inspection/checkpoint failures for worker and non-worker turns. Retain the 8 MiB generated-runtime gate and distinguish response preparation from observed provider delivery.
