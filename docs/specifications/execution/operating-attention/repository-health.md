# Repository health projection

The existing `lervo application attention --json` result adds `health`, a
`RepositoryHealthProjectionV1`. Compact terminal turns read the same private
`.lervo/state/repository-health.json` file. [ADR-0535](../../../decisions/execution/applications/0535-project-core-health-with-actor-owned-attention.md)
owns this change. The report digest binds the projection when present.

## Publication and reading

Schema 1 requires `kind: repository_health.projection`, `observedAt`, the exact
repository snapshot revision (including working bytes), and seven measures.
Each measure carries `value`, `observedAt`, `validUntil`, `source`, `coverage`
(`complete`, `partial`, `unknown`), `status` (`within_target`, `gap`, `unknown`),
and a nullable reason. An unknown measure has a null value. Partial observations
retain only verified portions and explicitly name missing evidence.

CLI resident reconciliation computes health without
providers or lint. Resident refresh follows successful, skipped and failed
cycles, after their heartbeat write. The background path reads the current
workstream file within its 64 KiB bound and at most 10,001 typed
`workstream.snapshot.recorded` events. The overflow read cannot establish complete
provenance. Missing state, missing artifacts, mismatched committed snapshot
coordinates or incomplete provenance produce unavailable workstream coverage;
this path never recovers state. The existing compact
`verifiedCurrentWorkstream` path still scans events and can restore missing state.

The health reader reads at most 64 KiB, validates schema and repository revision,
and checks per-source timestamps. It also reads the bounded resident heartbeat
projection: at most 64 rows. A fresh heartbeat with the same recorded resident
state preserves convergence through the resident's 15-minute reconcile ceiling;
missing, stale, future or changed hosting yields unknown. This read proves
hosting only and cannot renew the maintenance observation. No health read scans
events, invokes providers or lint, or repairs state.

The whole projection and maintenance observations expire after 20 minutes.
Staleness evaluation, freshness cycle and capture evidence expire after 24 hours;
resident heartbeat evidence expires after 120 seconds. Future timestamps are
unknown. Missing, unreadable, invalid, stale and changed-revision projections
have explicit reasons. An old file is never healthy by default.

A singleton private `.lervo/state/repository-health-generation.sqlite` counter
is claimed before source reads. Publication rechecks this generation and renames
one private temporary file atomically in the same SQLite write transaction.
A newer computation fences every older one, including overlapping host and watch
resident processes on the same checkout. An unchanged repository snapshot
revision is also required. A failed or superseded computation leaves the old
file to expire. The counter has one row; the projection replaces one file.
There is no event, history directory or append-only collection.

## Measures

- **Convergence:** maintenance observation, live heartbeat, recorded stage stops
  and continuity findings. State, reason, stop time, resident state, actor and
  recovery condition remain distinct. Repeated same-reason stage events retain
  the first stop time. Missing recovery is `none recorded`, with an inspect command.
  On a host the convergence fence does not make the owner, the measure reports
  the owner peer's published resident state as `owner_elsewhere`; a missing or
  older-than-90-minute owner observation is unknown with
  `owner_observation_missing_or_stale` ([ADR-0548](../../../decisions/execution/applications/0548-report-convergence-where-it-runs-and-record-when-stops-are-shown.md)).
- **Longest stop:** bounded stage history closes an episode on recorded progress
  or resolution. Future events cannot open or close an episode. Stop duration
  does not establish reporting. Owner terminal turns record each stop's first
  prepared appearance in `.lervo/state/repository-health-appearance.json`.
  A shown stop reports `reportedAt` and the time until it was shown; a stop
  that started after recording began and was never shown reports its whole
  duration as unreported. Older stops, or a missing record, keep both null with
  `attention_appearance_unrecorded` and render `reporting unknown`.
- **Freshness:** current-HEAD staleness evaluation and cycle summary are independent.
  Evaluation carries nullable stale/evaluated/unevaluated/unknown counts plus
  `evaluationObservedAt` and `evaluationValidUntil`. Cycle carries nullable
  stale/safety/review/refreshed/blocked fields, first safety path, `cycleObservedAt`
  and `cycleValidUntil`. The reader expires each portion independently. Missing,
  changed-HEAD or stale evaluation preserves a valid cycle summary, and vice
  versa. The aggregate is partial when one portion is unknown and wholly unknown
  only when both are unknown. A cycle never supplies an evaluated denominator.
- **Owner review:** source currency gates both items and counts. Stale or missing
  capture/cycle evidence cannot become current owner requests or establish zero.
  Stale convergence-owner and continuity observations are also excluded. `count`
  and `upkeepCount` are null when overall coverage is incomplete; `confirmedCount`
  retains the verified owner portion. `workstreamCount` identifies that portion's
  workstream approvals so current evidence can replace cached approvals, including
  omitted ones. At most 32 summaries are retained; `omitted` counts the verified
  owner summaries beyond the returned items. Each summary names the consequence,
  recommendation, waiting age and exact inspect command. Unknown total coverage
  is separate from known omissions. Original typed source items remain inspectable.
- **Deferred documents:** the provider-free layout plan supplies
  `semantic_classification_pending` count, at most 32 relative paths and exact
  omissions. First-seen time is unrecorded, so age is unknown. Partial layout
  coverage cannot establish zero.
- **Broken links:** the link web over current Markdown, rebuilt in the background
  when tracked Markdown changes, gives broken links, amendments not linked back,
  and unlinked canonical documents ([ADR-0551](../../../decisions/knowledge/documents/links/0551-measure-the-document-link-web-deterministically.md)).
  The first two are gaps. A summary older than one day, or a failed rebuild, is
  unknown. This measure never invokes lint.
- **Find:** the reader keeps whole stage history and only eight days of per-turn
  activity, retaining at most 10,000 events from at most 250,000 scanned; overflow
  or failed reads are unknown. It establishes recorded last injection, seven-day
  reference/preparation counts, and terminal turns with selected documents and
  path citations. Either managed injection with references or terminal selection
  with citations proves Find ([ADR-0550](../../../decisions/execution/grounding/0550-measure-find-on-terminal-turns-and-replay-past-changes.md)).
  The last replay over past changes adds recall and precision, and the governance
  check adds how many changing turns missed the canon that names a changed path
  ([ADR-0552](../../../decisions/execution/grounding/0552-check-changes-against-the-canon-that-names-them.md)). Future events are
  excluded. No local injection event means `last recorded injection unknown`; it
  cannot prove no injection occurred. Complete recorded counts may be zero.
  Prepared, injected, referenced and used remain distinct.

## Actor and authority

Attention retains typed fields and source guidance in `recordedInstruction`.
Attribution adds actor, consequence, recommendation, exact inspect command and
waiting age. Unrecorded or future waiting times have unknown age. Stale items
retain their re-verification `instruction` for existing consumers. Attribution
proves neither a running worker nor permission for an effect.

Only structured consequential effects under AGENTS.md invariant 10 require the
owner. A held review, settled decision, provider failure or classification task
belongs to its named resident, reviewer, proxy, publisher or coordinator.
`hub_forbidden` requires owner scope authority. `hub_unauthorized` and
`token_file_unreadable` require credential authority. Existing knowledge
convergence delegation grants neither credential replacement nor Hub permission
management. Delegation/continuity scope decisions, exact repository write
approvals, user-owned freshness writes, safety/policy changes and replica
overwrites retain their authority checks. Workstream blockers remain blocking
without making the owner their default actor.

Freshness classification covers every candidate before the 256-item attention
return cap. `summary.byKind` and total/user-action/omitted counts reflect that full
classification. Owner items sort first. Exact review commands and
`lervo knowledge freshness status` retain an inspection path beyond the cap.

## Compact rendering

Healthy output is empty. Each gap is one `Lervo health:` line naming its actor or
recovery condition. Unknown and partial measures share one collapsed unknown
line. The first line carries projection age. Raw event counter dumps and upkeep
counts stay in JSON. Owner authority is one batch with recommendations, inspect
commands and omissions; an incomplete total reads `at least` the confirmed count.

Currently read workstream approvals replace cached workstream entries, merge
with cached owner effects and deduplicate by stable item identity. A missing,
stale or changed-revision health file cannot hide a currently observed approval.
Resolved or stale workstream approvals do not reappear through the cache.

The health section is at most 520 UTF-8 bytes, including newlines, age and
omissions. Whole lines and inspect commands survive; omitted lines point to the
full JSON. The complete compact context remains bounded to 4,096 bytes. These
are prepared bytes, never proof of delivery, acknowledgement or resolution.

The private projection and generation state exclude prompt bodies, provider
output, document contents, credentials, absolute host paths and platform-specific
coordinates. Both are rebuildable state, never canonical authority.
