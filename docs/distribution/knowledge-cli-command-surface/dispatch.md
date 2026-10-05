# Dispatch and local inspection

## Routing

The dispatcher forwards export, import, and OKF commands with their original arguments. It removes the leading subcommand when forwarding convergence, worker, canonicalization, normalization, review-policy, review, materialization, structure, freshness, and instruction commands.

Refresh invokes migration in `refresh` mode. Compile, compare, stability, merge-candidate, and fuzzy-merge-candidate share the compilation wrapper. Pattern effect takes precedence over general pattern dispatch and receives the supplied services. Instruction receives the optional `groundProductionRequest` service only when supplied.

Routing does not establish imported handler behavior or successful execution.

## Local inspection

Impact, refresh-candidate, reconcile, lint, and query parse options strictly, accept `--json`, and resolve `--root` relative to the CLI working directory, defaulting to `.`. Impact, refresh-candidate, and lint reject positional arguments. Reconcile requires exactly one compilation ID. Query joins and trims positional words and rejects an empty sentence.

### Impact and refresh-candidate

Both collect local supplemental sources, scan configured knowledge, and analyze impact.

- Impact emits the complete report as JSON or a text summary containing counts, report and snapshot IDs, lineage completeness, and non-current items.
- Refresh-candidate constructs a review candidate and prints its status, identifiers, actions, freshness, and reasons. Text output explicitly states that publications were not changed automatically.

Both return zero after successful processing, regardless of reported status.

### Reconcile

Reconcile collects local supplemental sources and builds a reconciliation plan. Text output counts registration, generation, relation, user-patch, conflict, and review-required dispositions and describes the plan as read-only. Conflict status returns one; other successfully returned statuses return zero. This wrapper has no apply operation.

### Lint

Lint collects local supplemental sources and prints JSON or validity, concept count, error and warning counts, and issue details. It returns zero only when `result.valid` is truthy. Once JSON mode is parsed, caught errors use `writeCommandError`; otherwise, errors include the message and usage text.

### Query

Query uses interactive local supplemental sources and `productDefaultRepositoryKnowledgeRanker`. Text output includes hit count, scores, titles, paths, and freshness, explicitly distinguishing recommendations from evidence of loaded, injected, or used context. Successful queries return zero, including queries with no hits.

## Other errors

Other locally handled exceptions print the error message or string representation followed by usage and return one. Unsupported subcommands also print usage and return one. These paths do not establish a shared bounded or redacted error contract.
