# Advertised command families

The usage string in `knowledge-usage.ts` advertises the following interface. Enforcement belongs to the respective handlers.

- Refresh: optional root, rebuild, integration-head, apply plan ID, and JSON output.
- Canonicalization: status with an optional candidate ID; defer or reject review with reviewer and candidate-hash approval; promotion with canonical target, target hash, reviewer, and candidate-hash approval.
- Patterns: provider-backed proposal from JSON or stdin; status; accept, reject, defer, or supersede review; approved promotion; effect collection, registration, and observation. Effect collection requires local events in the advertised syntax. Registration and observation advertise optional local events and paired apply/write options.
- Compilation: compile and provider-based stability accept Codex or Claude, root, model, executable, and a timeout from 1,000 to 600,000 milliseconds. Stability also advertises baseline/candidate comparison. Compare accepts Codex and Claude compilation IDs; merge and fuzzy-merge candidates additionally take a comparison ID.
- Normalization: provider or candidate selection, optional model/executable/timeout, and apply with per-operation approval hashes.
- Workers and convergence: once or watch with a provider; status or inspect; delegation from reviewed JSON with an optional asset manifest and apply plan; explicit provider probe.
- Semantic review: reconciliation by compilation ID; review-policy with reviewer, optional policy ID and conflict-resolution permission, and write; review with plan, policy, reviewer, and safe acceptance, per-item approval, conflict resolution, or rejection; materialization by review ID with optional apply, or recovery mode.
- Structure: delete, move, merge, and heading-based split of relative Markdown paths, with optional exact plan and operation approvals.
- Freshness: status, review, apply with an after-hash approval and optional reviewer, revert, reject with `not_stale` or `incorrect`, and acknowledge.
- Instructions: provider-backed intake from JSON or stdin, status, apply/reject review with reviewer and candidate-hash approval, and a Claude bridge with optional plan and operation approvals.
- OKF: export to a new path, import with optional apply plan, bundle lint and query, and candidate re-export to a new path.

Most families advertise root and JSON options; worker and convergence syntax has narrower option lists. Help text alone proves neither mutation authority nor exact parser validation, imported handler behavior, or successful execution.
