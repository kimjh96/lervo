# Knowledge CLI command surface

This reference describes `apps/cli/src/knowledge-command.ts` and the advertised syntax in `knowledge-usage.ts`. It supplements the [background worker wrappers](../specs/background-knowledge-convergence/runtime/cli-wrappers.md). Routing and help text do not establish imported handler behavior or successful execution.

## Dispatch and local inspection

The dispatcher forwards export, import, and OKF commands with their original arguments. It forwards convergence, worker, canonicalization, normalization, review-policy, review, materialization, structure, freshness, and instruction commands without the leading subcommand. Refresh invokes migration in `refresh` mode. Compile, compare, stability, merge-candidate, and fuzzy-merge-candidate share the compilation wrapper. Pattern effect takes precedence over general pattern dispatch and receives the supplied services. Instruction receives an optional `groundProductionRequest` service only when supplied.

Impact, refresh-candidate, reconcile, lint, and query parse options strictly and resolve `--root` relative to the CLI working directory, defaulting to `.`. Each accepts `--json`. Impact, refresh-candidate, and lint reject positional arguments; reconcile requires exactly one compilation ID. Query joins and trims positional words and rejects an empty sentence.

Impact and refresh-candidate collect local supplemental sources, scan configured knowledge, and analyze impact. Impact emits the complete report as JSON or a text summary with counts, report and snapshot IDs, lineage completeness, and non-current items. Refresh-candidate constructs a review candidate and prints its status, identifiers, actions, freshness, and reasons. Its text output explicitly says publications were not changed automatically. Both return zero after successful processing, independently of the reported status.

Reconcile collects local supplemental sources and builds a reconciliation plan. Text output counts registration, generation, relation, user-patch, conflict, and review-required dispositions and describes the plan as read-only. A conflict status returns one; other successfully returned statuses return zero. This wrapper contains no apply operation.

Lint collects local supplemental sources and prints JSON or validity, concept count, error and warning counts, and issue details. It returns zero only when `result.valid` is truthy. Once JSON mode is parsed, caught errors use `writeCommandError`; otherwise errors include the message and usage text.

Query uses interactive local supplemental sources and `productDefaultRepositoryKnowledgeRanker`. Text output gives hit count, scores, titles, paths, and freshness, explicitly distinguishing recommendations from evidence of loaded, injected, or used context. A successful query returns zero, including when there are no hits.

The other locally handled exceptions print the error message or string representation followed by usage and return one. Unsupported subcommands also print usage and return one. These paths do not establish a shared bounded or redacted error contract.

## Advertised command families

The usage string advertises the following interface. Enforcement belongs to the respective handlers.

- Refresh: optional root, rebuild, integration-head, apply plan ID, and JSON output.
- Canonicalization: status with an optional candidate ID; defer or reject review with reviewer and candidate-hash approval; promotion with canonical target, target hash, reviewer, and candidate-hash approval.
- Patterns: provider-backed proposal from JSON or stdin; status; accept, reject, defer, or supersede review; approved promotion; and effect collection, registration, and observation. Effect collection requires local events in the advertised syntax; registration and observation advertise optional local events and paired apply/write options.
- Compilation: compile and provider-based stability accept Codex or Claude, root, model, executable, and a timeout from 1,000 to 600,000 milliseconds. Stability also advertises baseline/candidate comparison. Compare accepts Codex and Claude compilation IDs; merge and fuzzy-merge candidates additionally take a comparison ID.
- Normalization: provider or candidate selection, optional model/executable/timeout, and apply with per-operation approval hashes.
- Workers and convergence: once or watch with a provider; status or inspect; delegation from reviewed JSON with an optional asset manifest and apply plan; and explicit provider probe.
- Semantic review: reconciliation by compilation ID; review-policy with reviewer, optional policy ID and conflict-resolution permission, and write; review with plan, policy, reviewer, and safe acceptance, per-item approval, conflict resolution, or rejection; materialization by review ID with optional apply, or recovery mode.
- Structure: delete, move, merge, and heading-based split of relative Markdown paths, with optional exact plan and operation approvals.
- Freshness: status, review, apply with an after-hash approval and optional reviewer, revert, reject with `not_stale` or `incorrect`, and acknowledge.
- Instructions: provider-backed intake from JSON or stdin, status, apply/reject review with reviewer and candidate-hash approval, and a Claude bridge with optional plan and operation approvals.
- OKF: export to a new path, import with optional apply plan, bundle lint and query, and candidate re-export to a new path.

Root and JSON options are advertised on most families; worker and convergence syntax has its own narrower option lists. Help text alone proves neither mutation authority nor exact parser validation. No test, installed journey, or historical knowledge obligation is resolved by these two source files.
