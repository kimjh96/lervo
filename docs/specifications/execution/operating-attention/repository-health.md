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
have explicit reasons. An old file is never healthy by default. Terminal turns
accept a changed-revision projection inside the 20-minute window and label its
age `before the latest repository change`; operating attention keeps the exact
revision. The resident refreshes the projection every five minutes and after each
cycle, one refresh at a time ([ADR-0555](../../../decisions/execution/applications/0555-keep-operating-signals-visible-and-honest.md)).

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
  When the convergence fence reports `waiting_owner`, `yielding`, or `contended`,
  the measure reads the owner peer's published continuity observation instead of
  local stage records, reporting `owner_elsewhere` and `resident on <host label>`.
  It reports a gap only when the owner's resident state is `attention` or `waiting`,
  with reason `owner_resident_<state>`. A missing, older-than-90-minute, or future
  owner observation is unknown with `owner_observation_missing_or_stale`; a local
  record never substitutes for it ([ADR-0548](../../../decisions/execution/applications/0548-report-convergence-where-it-runs-and-record-when-stops-are-shown.md)).
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
- **Lervo debt:** every change Lervo holds as its own debt ([ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).
  Attention items in state `lervo_debt` supply held freshness candidates and
  findings, held capture, canonicalization candidates the reviewer deferred
  twice, continuity, unverifiable or contended convergence ownership, publication
  failures and held superseded commits, replica divergence, held foreground
  effects, and approvals that stored workstream snapshots still record. The
  maintenance observation supplies `knowledge_sources_parked`. The Node health
  snapshot supplies supervision and workstream replication components in status
  `lervo_debt`, each with the time its reason was first observed. The value
  carries the total count, the oldest start and its age, the most frequent reason,
  at most 16 per-source summaries, and at most eight missing credentials.
  Coverage is partial when an attention source is unavailable or the report was
  truncated. None of it is owner work.
- **Deferred documents:** the provider-free layout plan supplies
  `semantic_classification_pending` count, at most 32 relative paths and exact
  omissions. First-seen time is unrecorded, so age is unknown. Partial layout
  coverage cannot establish zero.
- **Broken links:** the link web over current Markdown gives broken links,
  amendments not linked back, and unlinked canonical documents
  ([ADR-0551](../../../decisions/knowledge/documents/links/0551-measure-the-document-link-web-deterministically.md)).
  Background health prefetch rebuilds it only when its input digest changes:
  the content hash of every tracked or untracked-but-not-ignored Markdown file,
  the full path set that link targets resolve against, and the layout taxonomy
  that decides canonical and archive scopes. An unchanged digest is re-observed
  after an hour so an idle repository's measure does not expire.
  The first two findings are gaps. A summary older than one day, or a failed
  rebuild, is unknown. This measure never invokes lint.
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

Under ADR-0561 no attention item requires the owner except a missing credential
Lervo cannot create: `hub_unauthorized`, `token_file_unreadable`, and
`hub_forbidden` convergence ownership failures, and a `gh` login a knowledge
publication needs. Those items have state `credentials_missing`, actor `owner`,
and consequence `credentials`; they are notices that never block the stages that
do not need them. A held review, settled decision, provider failure,
classification task, recorded workstream approval, or ownership contention
belongs to its named resident, reviewer, proxy, publisher, coordinator, or
working agent. Workstream blockers remain blocking without making the owner
their default actor.

Freshness classification covers every candidate before the 256-item attention
return cap. `summary.byKind` and total/user-action/omitted counts reflect that full
classification. Credential notices sort first. Exact review commands and
`lervo knowledge freshness status` retain an inspection path beyond the cap.

## Compact rendering

Healthy output is empty. Each gap is one `Lervo health:` line naming its actor or
recovery condition. Unknown and partial measures share one collapsed unknown
line. The first line carries projection age. Raw event counter dumps stay in
JSON. Lervo debt is one line with its count, oldest age, most frequent reason, and
the three oldest sources; details stay in `lervo application attention --json`.
A missing credential adds one notice line naming the first recommendation and
its inspect command.

Currently read workstream approvals replace the cached workstream debt source.
A missing, stale or changed-revision health file cannot hide a currently
observed recorded approval, and a settled one does not reappear through the
cache.

The health section is at most 520 UTF-8 bytes, including newlines, age and
omissions. Whole lines and inspect commands survive; omitted lines point to the
full JSON. The complete compact context remains bounded to 4,096 bytes. These
are prepared bytes, never proof of delivery, acknowledgement or resolution.

The private projection and generation state exclude prompt bodies, provider
output, document contents, credentials, absolute host paths and platform-specific
coordinates. Both are rebuildable state, never canonical authority.
