# Core loop roadmap

Status: `active`

As of: 2026-11-10

## Outcome

Make the Lervo core solid before widening it. Know, Find, Connect, Do, Collaborate, and Surface run as one loop over one verified relation web. The loop is fast and token-lean, and the owner is never a review or approval step. The same Lervo then continues on every host.

Decisions: [ADR-0560 core hardening](../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md), [ADR-0561 decide without the owner](../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), and [ADR-0562 one relation web](../decisions/foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md).

## Release rule

The owner ruled on 2026-11-02 that nothing is released or deployed until every milestone below up to the integration step is done. Then one release and one fleet deployment follow, with the Hub before the Nodes.

## Ordered milestones

### Remove unused parts and owner approvals

1. **ADR-0560 removal:** done on branch `remove-unused-subsystems`, unreleased.
2. **ADR-0561 owner approvals:** A1 to A7 are done on branch `remove-owner-approval-gates`. Open:
   - Find and fix the cause of the `failure-recovery` test that takes about 60 seconds. 1,272 synchronous Git calls in source capture explain about 22 seconds; about 44 seconds are unexplained.
   - Rerun `pnpm quality:check`.
   - Hub remote-command approval stays a documented boundary until a Node two-check path exists.

### One relation web (ADR-0562)

Work happens on branch `core-loop`, stacked on the ADR-0561 branch.

1. **Relation web and replay:** done. The ADR-0560 replay reaches recall 85/85.
2. **Document lifecycle** (section 2): in progress. Run the new resolution test, add tests, measure again, update the specification, add release intent, and commit. Fix the source-lineage limit of 256 records before its next write fails.
3. **Plan ledger** (section 6): capture items from transcripts, keep them as a tree, close them only with evidence, and generate the workstream from the ledger. Restoring the ledger after compaction lands with milestone 9; until then the existing prompt hook prints the open items.
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

### Integration and release

1. Rebase `core-loop` onto the ADR-0561 branch, and both onto `origin/main`, resolving conflicts with the background knowledge commits that landed after 2026-11-02.
2. Run a Codex adversarial review and judge each finding again.
3. Open the pull requests, release once, and deploy the fleet with the Hub first.
4. Verify that Lervo applies the argo layout itself and sends a notice with the undo command.

## Completion

Each milestone is complete when its ADR verification item is observed on an installed host, not when its code is merged.
