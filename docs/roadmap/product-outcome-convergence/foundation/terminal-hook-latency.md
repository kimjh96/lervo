# Terminal hook latency

Outcome: terminal hooks meet reviewed latency budgets.

State: `implemented`.

The current Codex hook build passed a fresh fixed-request cohort of 30 complete Prompt/Stop pairs. Prompt p95 was 13,937.214 ms; Stop p95 was 1,942.938 ms. Both maxima were below 30 seconds.

Query projection runs concurrently with corpus preparation and repository snapshotting. Project and publication-language coordinates are checked before any result is used. Earlier failed and passing profiles remain retained. A 100-report view still blocks on the preceding build's p95 exhaustion; per-context token exhaustion also blocks at the inclusive configured boundary.

See [terminal hook latency requalification v2](../../../evidence/foundation/terminal-hook-latency-requalification-v2.md).

Ongoing proof: keep profile-separated 30-sample operational evidence current after material hook changes. A monetary cost budget remains unavailable until an accounting and price coordinate is observable.
