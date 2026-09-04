# Terminal hook latency

Outcome: terminal hooks meet reviewed latency budgets.

State: `implemented`.

One current-build Codex profile passed: Prompt p95 was 14,553.077 ms across 33 samples; Stop p95 was 1,857.033 ms across 30 samples. Both maxima remained below 30 seconds. The prior failed profile is retained; a 100-report view still blocks on its p95 exhaustion. Per-context token exhaustion also blocks at the inclusive configured boundary.

Ongoing proof: keep profile-separated 30-sample operational evidence current after material hook changes. A monetary cost budget remains unavailable until an accounting and price coordinate is observable.
