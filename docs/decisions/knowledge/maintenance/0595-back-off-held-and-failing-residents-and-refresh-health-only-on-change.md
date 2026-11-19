# ADR-0595: Back off held and failing residents and refresh health only on change

Status: `accepted`
Decision date: 2026-11-19
Amends: [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (which results are idle-class, and when an unchanged fence must run in full), [ADR-0555](../../execution/applications/0555-keep-operating-signals-visible-and-honest.md) (when the resident refreshes the health projection)
Related: [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [ADR-0580](0580-let-a-resident-with-parked-work-back-off.md), [ADR-0535](../../execution/applications/0535-project-core-health-with-actor-owned-attention.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

On 2026-11-19 the Mac knowledge host again used 50 to 128 percent of a CPU core. The last 3 MB of `knowledge-host.log` held 411 completed resident cycles across 7 repositories. In that window, `axli-lab` ran 133 cycles, and every one returned `busy` with reason `repository_owner_hold`. The next busiest repository ran 80.

Read-only analysis of `origin/main` found these causes:

1. **A held repository never backs off.** The worker returns `busy / repository_owner_hold` before any stage (ADR-0561). `classifyResidentCycle` mapped every `busy` result to `processed`, which resets the idle streak and is never skippable. The held resident therefore observed every 60 seconds, forever.
2. **Health prefetch ignores the fence.** `prefetchRepositoryHealth` ran after every observation, including skipped and held ones, and on its own 5-minute timer. Each run plans the repository layout, which is a full repository scan. The cycle cost report does not measure it, so the log understates the total.
3. **Every repository ran in full at least every 15 minutes, and the clock forced it every 30.** The skip contract expired after 15 minutes. Behind that, the fence carried a 30-minute practice window that changed on every repository whether or not practice had anything to do: about 16 full cycles an hour across 8 repositories.
4. **A failure outside the fence retried at the base cadence.** A failed full cycle already counted toward the idle streak. A failure before the fence, such as an ownership observation that threw, reset the timer to the 60-second base on every attempt.

Sharing one repository scan across a cycle's stages (ADR-0582 reuse inside the resident) is a separate change and is not part of this decision.

## Decision

### A held repository is idle-class

A full cycle that returns `busy` with reason `repository_owner_hold` records the new result `held`. `held` is skippable like `idle`, `waiting`, and `attention`, and it grows the idle streak, so a held resident backs off 1, 2, 4, 8, and then 15 minutes. Any other `busy` result, such as a cycle that yielded to an upgrade, stays `processed`.

The host hold store (`repository-holds.json` beside the repository registry) enters the fence as file metadata. A hold or a release changes the fingerprint, so the next observation runs in full instead of skipping. Because a held resident sleeps up to 15 minutes, it also checks the hold once a minute; a release wakes it like an event, through the 30-second debounce, with the streak reset.

A skipped held cycle reports health `busy` with reason `repository_owner_hold`, as the full held cycle does.

ADR-0561 is unchanged: the worker still returns before any stage, and publication and continuity still wait while the repository is held.

### Health refreshes only when its inputs change

The resident keeps one in-memory record per repository: the projection input key and when it last refreshed. The key digests:

- the ADR-0461 repository digest (head, status, dirty-path metadata, index, policy, delegation, candidates);
- the event store head;
- the size and modification time of these state files: node runtime health, maintenance observation, freshness cycle, document staleness, document lifecycle, convergence continuity, and instruction capture state;
- the owner fence's role and holder only, because every ownership observation rewrites the fence;
- the host hold store metadata;
- the resident's own reported state and reason.

An offer refreshes when the key changed, when no record exists, or when the last refresh is at least 15 minutes old. Fifteen minutes stays under the 20-minute display window of ADR-0535.

The projection also reads inputs the key leaves out: cached operating attention sources such as held effects and replica receipts, the terminal lifecycle cache, the appearance, the Find replay and turn governance summaries, and the publication state. These rely on the 15-minute age bound. The prefetch rewrites some of them itself, so keying on them would refresh it again after every refresh.

After a skipped observation with no publication since, the key reuses the repository digest the fence just computed. This saves one `git status` per observation.

The resident offers a refresh after every observation, as before. The 5-minute timer becomes a 60-second check. While a full cycle is running, the check applies only the age bound, because the cycle's own events would change the key on every check, and the cycle's own offer follows its changes.

A held repository refreshes when the hold starts, so the projection shows it, and then every 60 minutes until it is released. The resident applies nothing there, so its own work cannot change the key. The hourly refresh keeps the Node, replica and attention lines of a held repository from going stale forever. Between those refreshes, the projection is older than the 20-minute display window and reads as stale. It is never shown as current.

Correctness comes first. A key that cannot be read refreshes. A refresh that fails records nothing, so the next offer tries again. The record is process memory; a restart refreshes once.

### An unchanged fingerprint runs in full at most hourly

The skip contract uses a new `RESIDENT_FORCED_FULL_CYCLE_MILLISECONDS` of 60 minutes in place of the 15-minute reconcile ceiling. The reconcile ceiling still bounds how long the resident sleeps between observations, so changes are still noticed within 15 minutes. The forced interval is validated to be no shorter than the ceiling.

Work that arrives outside the fingerprint now waits up to 60 minutes instead of 15. For example, the WSL owner receives owner-rule candidates from the Mac through the Hub exchange (ADR-0545).

### Practice and the skill day wake the resident when due

The 30-minute practice window leaves the fingerprint. In its place, the fence observes the practice schedule from `practice/state.json`. The file is parsed again only when its metadata changes. The schedule has two parts:

- **Due digest.** It names the practice moments already due:
  - a work record's quiet period ending 30 minutes after it was observed;
  - an active candidate;
  - an unresolved candidate's 7-day expiry;
  - the daily usage window of generated skills;
  - any resume time.

  Each newly due moment changes the fingerprint once. A moment that stays due while the stage waits does not change it again.

- **Next wake.** The earliest future scheduled moment enters `earliestAvailableAt`, so the resident wakes exactly then. A non-owner keeps this local wake beside the holder's lease wake.

Resume times after an admission wait, such as `foreground_pending` while the owner works, change the due digest but set no timer. They recur every minute, and the backoff picks them up instead.

The daily `terminalSkillsDay` stays in the fingerprint, and the next UTC day boundary is a local wake, so the daily usage window rolls over on time.

An unreadable or invalid practice state keeps the 30-minute window, so practice is never delayed by a schedule the fence cannot read.

### Failures back off and are never skipped

A failure before the fence now grows a failure streak and waits with the idle backoff: 60, 120, then 240 seconds, up to 15 minutes. A wakeup or a successful observation resets it. A failed full cycle keeps its existing streak growth. It records no fingerprint, so the next observation always runs in full.

## States, events, privacy, and failure meaning

- `resident-cycle.json` keeps schema 1. `lastResult` may be `held`. A reader that does not know `held` treats the file as invalid and runs one full cycle; the file is a rebuildable projection.
- No event, health reason, or tracked file is added. The new cost scope `projection_fence` names the key computation.
- The projection key holds digests, sizes, timestamps, and the owner role and holder label that the projection already shows. It is never persisted.
- A key read failure or an unreadable owner fence refreshes. A hold store read failure counts as held, as ADR-0561 requires.

## Consequences

For `axli-lab` in the measured window, 133 held observations at the 60-second cadence, each followed by a full health prefetch, become about 4 observations an hour with no prefetch after the first. A held cycle is cheap: it returns at the hold check.

For an idle repository, the prefetch drops from after every observation plus every 5 minutes to at most once per 15 minutes, plus once after each full cycle that changed its inputs. Each 60-second check costs one stat pass and one `git rev-parse` and `git status`, the same observation as the fence; after a skipped observation it reuses the fence's digest.

Without practice work, an unchanged repository now runs in full once an hour and at the UTC day boundary, instead of every 30 minutes: about 8 full cycles an hour across 8 repositories, down from 16.

The host still scans the repository several times in each full cycle. Scan sharing inside the resident is the next change for roadmap item 6.

## Verification

- `packages/repository-knowledge-runtime/test/resident-cycle.test.ts`: a held result is `held`, skipped while unchanged, and backs off 1, 2, 4, and 8 minutes; a held repository with a changed fingerprint runs in full; an unchanged fingerprint skips until 60 minutes and then runs in full; three failures back off 60, 120, and 240 seconds and are never skipped; `held` state round-trips.
- `packages/repository-knowledge-runtime/test/source-fingerprint.test.ts`:
  - a hold and a release each change the fence;
  - an unchanged repository keeps its fence across 45 minutes;
  - a practice work record wakes the resident when its quiet period ends and changes the fence once;
  - the next UTC day is a local wake.
- `packages/repository-knowledge-runtime/test/practice-schedule.test.ts`:
  - no state schedules nothing;
  - a quiet period ends once;
  - a passed resume time changes the digest without a wake;
  - the daily usage window and the 7-day expiry;
  - unreadable state throws, so the fence keeps the window.
- `packages/repository-knowledge-runtime/test/resident-projection-fence.test.ts`: unchanged inputs skip 10 checks and refresh at the 15-minute bound; an event append, a state rewrite, a repository edit, and an owner role change each refresh once; an owner fence rewrite with the same role does not; an unreadable key and a failed refresh retry; a held repository refreshes when held, after 60 minutes, and on release; a supplied digest replaces the repository read; a check during a cycle applies only the age bound.
- `packages/repository-knowledge-runtime/test/loop-health.test.ts`:
  - a held resident backs off, with one health refresh and then one after an hour;
  - a separate test shows that a held resident wakes within 91 seconds of a release through the hold check, with its streak reset;
  - a failure before the fence backs off, and a wakeup resets it.
