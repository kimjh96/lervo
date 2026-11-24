# Core loop roadmap

Status: `active`

As of: 2026-11-19

## Outcome

Make the Lervo core solid before widening it. Know, Find, Connect, Do, Collaborate, and Surface run as one loop over one verified relation web. The loop is fast and token-lean, and the owner is never a review or approval step. The same Lervo then continues on every host.

Decisions: [ADR-0560 core hardening](../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md), [ADR-0561 decide without the owner](../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [ADR-0562 one relation web](../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md), and [ADR-0563 plan ledger](../decisions/foundation/0563-keep-the-plan-in-a-ledger-lervo-owns-and-check-it-at-every-stop.md).

## Release rule

On 2026-11-18 the owner replaced the single release ruled on 2026-11-02. Each step now lands on its own:

1. a pull request from `origin/main` with its release intent;
2. CI and one independent review;
3. a release;
4. the host follower installing it on every host.

## Ordered milestones

### Remove unused parts and owner approvals

1. **ADR-0560 removal:** released in v0.26.0.
2. **ADR-0561 owner approvals:** released in v0.27.1, with the follower fix in [ADR-0591](../decisions/distribution/0591-accept-the-previous-followers-upgrade-arguments.md). Both hosts installed it on 2026-11-18. Open:
   - Find and fix the cause of the `failure-recovery` test that takes about 60 seconds. 1,272 synchronous Git calls in source capture explain about 22 seconds; about 44 seconds are unexplained.
   - Hub remote-command approval stays a documented boundary until a Node two-check path exists.

### Fix observed host defects

Found on the Mac host on 2026-11-12. Each fix needs a regression test.

1. **Replica watcher leak:** `apps/node-runtime/src/repository-change-watch.ts` opens one `fs.watch` per tracked directory, about 3,100 across 5 repositories. On macOS, libuv 1.52.1 (Node v26.5.1) keeps every directory watcher in one FSEvents stream. It rebuilds that stream with every path whenever a watcher opens or closes, and leaks one string per path on each rebuild (`src/unix/fsevents.c` line 463). A reproduction leaked exactly N+1 allocations per rebuild. The service reached 15.7 GB in 30 days. Fix: on macOS and Windows, one recursive watch per repository root with in-process path filtering; Linux keeps one inotify watch per directory. Test that the number of watchers stays constant under directory churn and memory stays bounded.
2. **Stale replica service after upgrade:** the replica service definition names the floating `runtimes/node/current` path, so `lervo upgrade` sees an unchanged definition and never restarts it (`apps/cli/src/repository-replica-service.ts:297-299`). It ran code from 2026-10-13 through five releases. Fix: the service status returns the process id; a process without a binding in the current runtime is restarted; health reports `repository_replica_service_stale_runtime`; retention never prunes a runtime that a live process is bound to.
3. **fseventsd growth:** the system file event daemon reached 18 GB, which needed an administrator restart. The leak in item 1 does not explain it. Measure regrowth after the restart and find the client that drives it.
4. **Broken links from background knowledge:** the background commit `ce6cebc2` (2026-11-04) wrote 2 broken links in `docs/roadmap/natural-language-grounding-quality.md`. Background apply must pass link lint before it commits.
5. **Owner rules not applied:** on the installed 0.23.5, two owner rules stay as local candidates because convergence waits for an owner decision. ADR-0561 removes the wait; verify both rules land after the release.

### One relation web (ADR-0562)

Each item lands from `origin/main`. Branch `core-loop` keeps the work that has not landed yet.

1. **Relation web and replay:** done. It ships with `lervo knowledge web stats` and `lervo knowledge web suspects`. The replay runs on both sides of the ADR-0560 merge on main and must find all 87 documents that still named a removed part. Open: the header lint for a bare `ADR-NNNN` that ADR-0562 names.
2. **Document lifecycle** (section 2): lands in shadow. The lifecycle evaluator, its record, and the health counts run beside the ADR-0023 findings ([relation web spec](../specs/repository-knowledge-compilation/relation-web.md#document-lifecycle)). Open: measure on installed hosts how many suspects settle without a provider, and the sweep's cost. The switch of the findings, with the review-interval decision, is part of item 8, and the mechanical reverse header edits are item 7.
3. **Plan ledger** ([ADR-0563](../decisions/foundation/0563-keep-the-plan-in-a-ledger-lervo-owns-and-check-it-at-every-stop.md)): capture items from transcripts, keep them as a tree, close them only with evidence, and generate the workstream from the ledger. Bring related open items into each turn. Make the Stop hook block a turn that skips an owner clause, a related item, a stated finding, or a delivered health line without acting on it or deferring it. Record repeated misses. Restoring the ledger after compaction lands with milestone 9; until then the existing prompt hook prints the open items. Slice S1, the ledger with evidence-only close, schema 9 events, `lervo plan` and open items in every turn, has landed ([contract](../specifications/knowledge/plan-ledger.md)). Slice S2, capture of directives, stated plans and deferred findings through the existing owner-turn assessment, has landed too. Slice S2b closes the shown items an exchange finished, only with a merged pull request or release tag Lervo verifies, so the plan lines stop showing finished work. Next: S3 Stop check, first in shadow.
4. **Find misses and ADR numbers:** classify the 69 of 182 replay documents that are found only through prose, then add co-change edges, code identifiers, and a bounded model pass for the true misses. The duplicate ADR numbers are renumbered: the later decision of each pair moved to ADR-0620 to ADR-0629, and `pnpm docs:check` fails on a duplicate number.
5. **Stop ledger** (section 3): only the lease holder reports a stop. Every failure code maps to one action. Landed: a verification stop names its failed command in the status, the resident's observation and the health line. A failure the host caused retries with backoff when a command could not start or was not found, and is reevaluated after six hours when it ran out of time; the integrator's failed candidate suite names its command instead of failing unclassified (v0.46.6).
6. **No repeated host work** (section 5): the freshness fence keys on HEAD and the committed Markdown digest, and health prefetch runs only on change. On 2026-11-08 the Mac knowledge host used 100 to 159 percent of a CPU core; record CPU per stage and repository and show the drop. [ADR-0595](../decisions/knowledge/maintenance/0595-back-off-held-and-failing-residents-and-refresh-health-only-on-change.md) lands the held-repository backoff, change-driven health refresh, the hourly forced full cycle, and failure backoff. [ADR-0597](../decisions/knowledge/maintenance/0597-keep-idle-and-non-owner-residents-off-the-repository.md) stops non-owner inspection, makes the health check Git-free, gates whole-log reads on the event head, and spreads shared wakes. [ADR-0598](../decisions/knowledge/maintenance/0598-keep-an-owner-resident-from-waking-itself.md) keeps an owner from waking itself through its own outcome records, records no event for a quiet repeated freshness cycle, and backs off admission waits. [ADR-0599](../decisions/knowledge/maintenance/0599-read-health-history-incrementally-and-fence-non-owners-without-git.md) reads health history incrementally, rate-limits event-only health refreshes, slows the heartbeat to 45 seconds, and fences non-owners without Git. [ADR-0600](../decisions/knowledge/maintenance/0600-rewind-an-obligation-whose-own-commits-were-undone.md) rewinds an obligation whose own commits a reset undid, at most three times before it reports attention, so it stops requeuing a stage that can never match. [ADR-0601](../decisions/knowledge/maintenance/0601-read-queues-health-inputs-and-retention-roots-once-per-change.md) reads the outbox as one aggregate, keeps a non-owner's wake off the owner's backlog, reuses the health layout plan until its inputs change, and extends retention roots by non-lifecycle events. [ADR-0602](../decisions/knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md) has every event-store commit ping its watchers synchronously over per-subscriber FIFOs, so resident and Node event watchers no longer poll, verifies Node history on open and again right before it leaves the host, surfaces every wake failure as attention, guards idle timers in CI, replaces every interval with one deadline, and pushes Hub knowledge state (lease releases, owner rules, host records, presence) over held waits, so nothing runs on a cadence. Open: one shared repository scan per owner cycle, and the installed per-repository CPU comparison against a 2 percent idle target.
7. **Backlinks:** [ADR-0631](../decisions/knowledge/documents/links/0631-write-reverse-adr-header-lines-as-insert-only-freshness-edits.md) writes the missing `Amended by` and `Superseded in part by` lines through the freshness apply path as insert-only edits with no provider call, at most 8 records per cycle. On 2026-11-24 the Mac web held 142 missing lines in 81 records; 72 fit and 9 records near the documentation bound keep their reasons until they are split. Open: confirm on installed hosts that the 72 records get their lines. An undeclared full supersession changes the owner's status line, so a person settles it.
8. **Consumers read the web:** staleness, freshness, reference lint, governance, and governing preference read the web instead of extracting relations themselves. Slice 1 has landed: the governing index that governance and governing preference read is a view of the web, identical to the old index over this repository's 1,254 Markdown documents. Next: freshness supersession from the web's header edges, which also stops `Supersedes in part` reading as a full supersession; then staleness connected paths and Markdown-link lint from an in-memory web; then entrypoint lint and freshness references once the web keeps symbols and managed-block marks; last, the switch of staleness findings to the lifecycle under its own decision.
9. **Context assembler** (section 4): a thin hook client, base, delta, and pull tiers, the session start and compaction hooks, and telemetry for `selected`, `injected`, and `used`. Slice 1 has landed reader-first: the terminal runtime answers a provider `SessionStart` (`startup`, `resume`, `clear`, `compact`) with the base block and records the session's context epoch, before any installed hook registers the event, so a host on an older runtime never receives an event it rejects. Next: register Claude `SessionStart` and stop resending unchanged blocks within an epoch; then the schema-11 telemetry readers and writers (`context.epoch.started`, tier, bytes, `used` from the transcript) with Codex compaction detection; then the thin hook client over a resident socket, which does not exist yet.
10. **Find and Surface:** connect Find ranking and the health and attention surfaces to the web, the lifecycle, and the ledgers.

Milestones 4 to 8 do not depend on each other and may run in parallel.

### Same Lervo on every host

1. **Install and join:** `lervo host invite` and `lervo host join` with a one-time code, a scoped device credential, automatic registration, service install, and an end-to-end check.
2. **Continuation handoff:** a packet with branch, HEAD, replica worktree reference, workstream revision, conversation summary, open decisions, and the plan ledger, built by the assembler and stored in the Hub.
3. **Shared judgment state:** move host-private judgment state to tracked files or the Hub, with a two-host parity probe.
4. **Measured replication:** measure sync lag and divergence, and replace 30-second polling with file-watch replication for every registered repository. Today 5 of 13 repositories replicate.

### Verification on the fleet

1. Verify that Lervo applies the argo layout itself and sends a notice with the undo command.
2. Deploy the Hub before the Nodes whenever a step changes what the Hub reads.

## Completion

Each milestone is complete when its ADR verification item is observed on an installed host, not when its code is merged.
