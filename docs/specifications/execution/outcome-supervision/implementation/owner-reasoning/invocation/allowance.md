# Owner spend allowance

A reviewed V3 `ownerSpendAllowance` may impose an independent incremental reservation ceiling even when the mandate's aggregate policy is `per_attempt_only`. Its exact project and revocation event ID/hash anchor one owner lineage; derived successor mandates inherit the same allowance.

Before reserving and again before provider start, the Node reads the verified project event chain and exact owner decision artifacts after that anchor. Every recorded owner-reasoning decision retains its full reserved amount, including safe non-starts. No model-dependent usage conversion or implicit refund occurs.

An unavailable usage receipt or observed usage exceeding its reservation stops further starts pending review. A missing anchor, changed chain, corrupt plan, omitted current decision, or exceeded ceiling also fails closed. The initial reservation is fenced against an event-head change. A renewed, revoked per-attempt mandate cannot silently omit the reviewed allowance.

This is an admission bound, not a physical provider token cutoff or a claim about historical actual use.
