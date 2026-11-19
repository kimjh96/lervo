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

1. **Relation web and replay:** done. The ADR-0560 replay reaches recall 85/85. It lands with `lervo knowledge web stats` and `lervo knowledge web suspects`.
2. **Document lifecycle** (section 2): in progress on `core-loop`. Run the new resolution test, add tests, measure again, update the specification, add release intent, and commit. Fix the source-lineage limit of 256 records before its next write fails.
3. **Plan ledger** ([ADR-0563](../decisions/foundation/0563-keep-the-plan-in-a-ledger-lervo-owns-and-check-it-at-every-stop.md)): capture items from transcripts, keep them as a tree, close them only with evidence, and generate the workstream from the ledger. Bring related open items into each turn. Make the Stop hook block a turn that skips an owner clause, a related item, a stated finding, or a delivered health line without acting on it or deferring it. Record repeated misses. Restoring the ledger after compaction lands with milestone 9; until then the existing prompt hook prints the open items.
4. **Find misses and ADR numbers:** classify the 69 of 182 replay documents that are found only through prose, then add co-change edges, code identifiers, and a bounded model pass for the true misses. Renumber the duplicate ADR numbers (0222, 0353 to 0359, 0415, 0425) and add a lint for duplicates.
5. **Stop ledger** (section 3): only the lease holder reports a stop. Every failure code maps to one action.
6. **No repeated host work** (section 5): the freshness fence keys on HEAD and the committed Markdown digest, and health prefetch runs only on change. On 2026-11-08 the Mac knowledge host used 100 to 159 percent of a CPU core; record CPU per stage and repository and show the drop.
7. **Backlinks:** write the 107 missing amendment backlinks and `Superseded by` lines through the freshness apply path.
8. **Consumers read the web:** staleness, freshness, reference lint, governance, and governing preference read the web instead of extracting relations themselves.
9. **Context assembler** (section 4): a thin hook client, base, delta, and pull tiers, the session start and compaction hooks, and telemetry for `selected`, `injected`, and `used`.
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
