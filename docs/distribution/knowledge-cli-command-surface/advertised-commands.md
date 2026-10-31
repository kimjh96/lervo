# Advertised command families

The usage string in `knowledge-usage.ts` advertises the following interface. Enforcement belongs to the respective handlers.

- Refresh: optional root, rebuild, integration-head, apply plan ID, and JSON output.
- Canonicalization: status with an optional candidate ID; defer or reject review with reviewer and candidate-hash approval; promotion with canonical target, target hash, reviewer, and candidate-hash approval.
- Patterns: provider-backed proposal from JSON or stdin; status; accept, reject, defer, or supersede review; approved promotion; effect collection, registration, and observation. Effect collection requires local events in the advertised syntax. Registration and observation advertise optional local events and paired apply/write options.
- Normalization: provider or candidate selection, optional model/executable/timeout, and apply with per-operation approval hashes.
- Workers and convergence: once or watch with a provider; status or inspect; delegation from reviewed JSON with an optional asset manifest and apply plan; explicit provider probe.
- Materialization recovery: `materialize --recover` with optional root and JSON output. [ADR-0529](../../decisions/knowledge/semantics/0529-remove-the-semantic-compilation-pipeline.md) removed semantic compilation and review.
- Structure: delete, move, merge, and heading-based split of relative Markdown paths, with optional exact plan and operation approvals.
- Freshness: status, review, apply with an after-hash approval and optional reviewer, revert, reject with `not_stale` or `incorrect`, and acknowledge.
- Instructions: provider-backed intake from JSON or stdin, status, apply/reject review with reviewer and candidate-hash approval, and a Claude bridge with optional plan and operation approvals.
- OKF: export to a new path, import with optional apply plan, bundle lint and query, and candidate re-export to a new path.

Most families advertise root and JSON options; worker and convergence syntax has narrower option lists. Help text alone proves neither mutation authority nor exact parser validation, imported handler behavior, or successful execution.
