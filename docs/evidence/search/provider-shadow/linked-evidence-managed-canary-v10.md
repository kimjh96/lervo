# Managed linked-evidence canary v10 terminal report

Status: `terminally_stopped`
Date: 2026-08-29

V10 bound exact manifest `sha256:934aece6c2eea2798896cf2376c94cf3b31d5b7c64b5f62dd3a7e3a230d231a9` and completed the first Codex model turn through the native signed-in session. The turn took 187,910 ms and emitted an observed usage record. Completion was rejected because the six deterministically selected linked documents were absent from the E1 plan, E2 load set, and E3 injection evidence.

The deterministic selection contained all six linked documents. They were lost between `prepareContext` and `createContextPlan`: `prepareContext` accepted `linkedEvidenceSelections` but did not forward it. Loaded and injected lexical-search documents could not substitute for the canary's selected-linked-document evidence.

V10 stopped after that single Codex run without resume or retry. No Claude run occurred. V11 forwards selected linked evidence through context planning and adds a regression test at that boundary.

## Evidence

- Prepared manifest digest: `sha256:934aece6c2eea2798896cf2376c94cf3b31d5b7c64b5f62dd3a7e3a230d231a9`
- Failure observation file digest: `sha256:4ee1f072208f36ac0d3692e5143a6912c61425ebb9d17758912132198cca49d5`
- Provider: Codex, model `gpt-5.6-sol`, native signed-in session
- Completed model turns: 1
- Duration: 187,910 ms
- Input tokens: 1,414,321, including 1,312,512 cached input tokens
- Output tokens: 7,433, including 2,721 reasoning output tokens
- Total tokens: 1,421,754
- Deterministic selected linked documents: 6
- Selected linked documents observed at E1/E2/E3: 0
- Selection calls: 0
- Claude runs: 0
- Retries, repairs, and replacement runs: 0

## References

- [V10 exact-clock decision](../../../decisions/search/activation/provider-shadow-structured/0289-use-past-manifest-clock-for-key-free-managed-canary-v10.md)
- [V11 forwarding decision](../../../decisions/search/activation/provider-shadow-structured/0290-forward-linked-selections-for-key-free-managed-canary-v11.md)
- [Managed canary specification](../../../specifications/execution/managed-linked-evidence-canary.md)
