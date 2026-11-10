# ADR-0562: One relation web, one context assembler, and a stop ledger for the core loop

Status: `accepted`
Decision date: 2026-11-02
Amends: [ADR-0551 document link web](../knowledge/documents/links/0551-measure-the-document-link-web-deterministically.md), [ADR-0552 governing canon](../execution/grounding/0552-check-changes-against-the-canon-that-names-them.md), [ADR-0463 document freshness](../knowledge/documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [ADR-0550 Find measurement](../execution/grounding/0550-measure-find-on-terminal-turns-and-replay-past-changes.md), [ADR-0556 governing preference](../execution/grounding/0556-rank-canonical-documents-that-name-the-task-paths-first.md)
Related: [ADR-0560 core hardening](0560-remove-unused-subsystems-to-harden-the-core.md), [ADR-0561 decide without the owner](0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [ADR-0052 knowledge graph](../knowledge/semantics/0052-rebuildable-explicit-knowledge-graph.md)

## Context

The owner directed on 2026-11-02 that Know, Find, Connect, Do, Collaborate, and Surface run as one loop over one verified relation web, fast and token-lean, without the owner as a step. A survey on 2026-11-02 of the code and the Mac host's state found that the parts exist but do not form a loop:

- **Relations are computed many times, each partially.** The link web (ADR-0551), the governing index (ADR-0552), staleness connected paths, freshness supersession, reference lint, and the Hub knowledge graph each re-read Markdown and run the shared reference extractor with different filters. Only `Amends:` headers are parsed. `Supersedes:`, `Superseded by:`, and `Status:` lines in ADRs are not, so a superseded ADR still governs paths and ranks in Find. Package names, CLI commands, and bare `ADR-NNNN` mentions are not modelled at all.
- **Find misses what changed.** ADR-0560 removed 607 files. The governing index names 3 of them, through 2 documents, while 30 documents still describe removed packages and commands by name.
- **Lifecycle covers a seventh of the documents.** Of 1,738 documents, 222 have been evaluated for staleness and 1,516 never have, because staleness counts only strong references to non-Markdown paths, and only 254 of 1,263 canonical documents name a code path. 107 amendments have no backlink and 152 canonical documents have no inbound link. ADR-0551 measures these and defers repair; no repair path exists.
- **Stops have no owner.** The Mac reports shiflo `knowledge_verification_failed` (27 days), plen `knowledge_semantic_review_rejected` (22 days), and digimon `document_directory_file_capacity_exceeded` (23 days), but the convergence lease for all three moved to the WSL host weeks ago. The Mac never retries them and keeps repeating them. Transient snapshot races are reported like stops. The failing verification command of the Mac lervo stop is not surfaced.
- **The knowledge host is busy doing the same work again.** The freshness cycle fence hashes `git status` of the whole tree, so every edit reruns full lint, staleness, and `git grep`. 71 cycles in one log window admitted nothing. Health prefetch rehashes every Markdown file of 7 repositories every 5 minutes.
- **Context delivery is seven assemblers and none measures use.** The terminal compact path never loads documents, resends the same owner rules and health blocks every turn, drops rules "omitted for space" because rule conditions get no task paths, and has no session-start or compaction hook. Only managed runs record `context.injected`; the last was on 2026-09-08 on the Mac. The prompt hook runs storage opens, event-chain checks, a snapshot walk, and health reads synchronously: p95 is 2.2 s by stage timers and about 3 to 4 s end to end.
- **Plans are lost as a conversation grows.** On 2026-11-10 the owner observed that plans made at the start or in the middle of a conversation drop out, especially after the provider compacts it. The workstream on the Mac shows why. Its six next actions are long sentences an agent wrote by hand. Items the agent did not write down exist only in the conversation: the knowledge host CPU fix, the source-lineage cap, the Codex review, and the argo layout check. Notes are capped at nine, and 779 have been dropped. The title and references still describe a goal from months earlier. The last update was 2026-11-02, and Lervo itself marks it stale. After compaction the hook injects only the first next action. The provider writes the compaction summary, and Lervo never checks it against the plan.

## Decision

### 1. One relation web

Each checkout has one rebuildable relation web, `.lervo/state/relation-web.sqlite`, written only by the resident knowledge host. It is a projection (invariant 4): Markdown, repository state, and events stay canonical.

- **Nodes:** documents (with taxonomy role), ADR numbers as aliases of documents, files and directories, packages, CLI commands, owner rules, turns, and stops.
- **Edges**, each with evidence `{extractor version, source document, line, strength, observed revision}`: `links_to`; `names_path` (strong or weak, replacing both the governing relation and staleness connected paths); `names_package`; `names_command`; `names_adr`; the ADR header grammar `amends`, `supersedes`, `supersedes_part`, `part_of`, `related`; lineage `moved_to`, `split_into`, `merged_into`, `retired`; `scoped_to` (rule to paths); and turn usage `selected`, `injected`, `used`.
- **One extraction pass** per changed document, keyed by content hash and extractor version.
- **Reverse lookup on change.** A HEAD or worktree change maps changed and deleted paths, their directories, their packages, and their commands to the documents that name them, plus the supersession and amendment closure. That set is the suspect set the lifecycle consumes.
- The link web and governing index files remain for one release as views of the web. Staleness, freshness, reference lint, governance, and governing preference read the web. The Hub knowledge graph keeps only usage edges, copied from the web, and drops its dead `knowledge.*` branches.

### 2. Document lifecycle

Every document has one lifecycle state in the web: `current`, `suspect` (with reason), `refreshed`, `superseded`, `partially_superseded`, `archived`, or `retired`.

- Suspect reasons: a named path changed or was removed, a named package or command was removed, a linked target was superseded, amended, or moved, or a cadence sweep reached a document with no edges (a fixed number per day, so every document is evaluated within a bounded period).
- Resolution is deterministic first: if the change touched nothing the document names, the document returns to `current` with an assessed revision and no provider spend. Only the remainder goes to the freshness provider path of ADR-0463 and ADR-0561.
- A `Status:` line of `superseded` makes a document historical: it leaves the governing index, default Find, and orphan counts. `partially_superseded` stays current with its superseded part noted.
- ADR headers use one grammar (`Status`, `Supersedes`, `Superseded by`, `Amends`, `Amended by`, each with links). Lint reports a bare `ADR-NNNN` in a header.
- Missing reverse header lines (backlinks and `Superseded by`) are a mechanical edit class. Lervo writes them through the freshness apply path under ADR-0561: Tier 0 cross-check, a Lervo commit, and a notice with the revert command.

### 3. Every stop has an owner host and a next action

- A stop ledger in the web records each stop by repository, obligation, and code, with its owner host (the lease holder), the observing host, since, last progress, cause (including the failed verification command), action, and state.
- Only the current lease holder reports a convergence stop as live. A host that finds an obligation from an earlier lease generation marks it transferred or closed and stops repeating it.
- Every failure code maps to one action in an exhaustive table checked at compile time: retry with backoff for transient codes (source bytes changed, snapshot races, ignored-path timeouts), which never surface before a threshold; regenerate once and then hold as Lervo debt (ADR-0561); or park as debt and continue the queue.
- A stop without progress for 24 hours raises one Lervo debt line naming the owner host, the cause, and the exact next command.

### 4. One context assembler in the resident host

- The terminal hook becomes a thin client. It sends the prompt and transcript position to the resident host over a private local socket (same user, mode 0600) and prints what it returns. It opens no store and runs no Git. The host records events afterwards. If the host is unreachable, the hook prints the last cached base block and records `host_unreachable`.
- Delivery has three tiers per session epoch. An epoch starts at session start, resume, clear, or compaction.
  - **Base**, once per epoch: workstream headline, health headline, rules that apply everywhere.
  - **Delta**, each turn: only blocks whose content changed in this epoch, plus rules and at most three documents newly relevant to the task paths (paths in the prompt and paths changed since the last turn), resolved through `scoped_to` and `names_path`.
  - **Pull**, on demand: `lervo knowledge query` served from the host's prepared index.
- Lervo installs the Claude Code `SessionStart` hook (including the `compact` source) and detects Codex compaction from the transcript (`compacted` records), so the base returns after every compaction.
- Discord repository work and managed runs call the same assembler, so every channel records `selected`, `injected` (bytes and estimated tokens), and `used` the same way. `used` is a provider read or edit of the path found in the transcript after the turn, not a mention alone.

### 5. The host does no repeated work

- The freshness fence keys on HEAD, the committed Markdown digest, and the hold and candidate state, not on `git status`. A cycle that cannot admit a candidate today and has no deterministic finding does not run.
- Health prefetch runs for repositories this host owns, and only when its inputs changed.
- The resident records CPU and wall time per stage and repository.

### 6. A plan ledger that Lervo keeps from the conversation

Lervo, not the agent's memory, keeps the plan of a piece of work.

- **Capture from the transcript.** After each turn the resident host reads the new transcript records, the same pass that finds `used` in section 4. It extracts three kinds of item: owner directives, plans the agent states (step lists and "next" commitments), and findings the turn marks for later repair. Each item records its source session and transcript position. Capture does not depend on the agent calling a command.
- **A tree, not a list.** Items form a tree: objective, pillar, step, and sub-item. No item is dropped for space. An item closes only as `done`, `cancelled` (the owner withdrew it), or `superseded` (another item replaces it), and the reason is recorded.
- **Done needs evidence.** An item becomes `done` only when Lervo observes its evidence: a commit reachable from the named branch, a passing test or check event, a published release, or a deployment record. A statement in the conversation is not enough.
- **Uncertain extraction is a candidate.** An item the extractor is not sure of is held as a candidate and confirmed by an independent cross-check (ADR-0561). The owner is never asked to review it.
- **Restore and compare after compaction.** When the assembler of section 4 starts a `compact` epoch, the base tier includes the open items of the ledger as one line each. Lervo compares the provider's summary with the ledger and names every open item the summary omitted.
- **Drift at the end of a turn.** An owner directive with no item, or an open item untouched for a set number of turns, appears in the next delta as one line.
- **The workstream is a view.** The workstream objective, next actions, and blockers are generated from the ledger. Agents may still add items with `lervo workstream update`, which writes to the ledger.
- **One ledger on every host.** The ledger syncs through the Hub, so a session on another host or channel continues from the same items. It is the plan part of the continuation handoff.

## State, events, privacy, and failure meaning

- The web and the stop ledger are private, rebuildable state. Deleting them loses nothing; the host rebuilds them.
- `context.injected` gains `tier`, `byteCount`, and `estimatedTokens`. A new `context.epoch.started` records `{provider, cause: start|resume|clear|compact, preTokens?, postTokens?}`. Neither carries prompt or document bodies.
- The socket carries prompt text in memory only. The host never writes prompt text to disk.
- A web that fails to build leaves the previous web in place and reports `relation_web_stale` as Lervo debt. Consumers fall back to their previous behaviour for one release.
- The plan ledger is durable state, not a projection, because provider transcripts can be rotated or deleted. Each item stores `{itemId, parentId, kind: directive|plan|finding, title, state: candidate|open|in_progress|done|cancelled|superseded, source: {provider, sessionId, transcriptOffset}, evidence?, closedReason?}`. The title is a short paraphrase. The ledger never stores prompt text or document bodies. New events are `plan.item.captured`, `plan.item.closed`, and `plan.summary.gap` (an open item missing from a compaction summary). A failed extraction records `plan_capture_failed` as Lervo debt and keeps the previous ledger; the next turn retries from the same transcript position.

## Consequences

- One extraction pass replaces five. Find, lint, freshness, and governance agree because they read the same edges.
- Every document has a lifecycle state, and none waits indefinitely.
- The hook no longer pays for storage and Git on every prompt. Context is sent once per epoch, then only as it changes.
- Name edges (packages, commands, ADR numbers) add false suspects. Deterministic resolution absorbs most of them, and precision is reported.
- The order guarantees of ADR-0548 and ADR-0549 ("delivery recorded last") are restated for events the host commits after the hook returns.
- A plan survives compaction, a new session, and a change of host. Extraction can misread an item, so extracted items carry their source position, and an uncertain item stays a candidate until it is cross-checked.

## Verification

- **Acceptance:** replaying the ADR-0560 deletion against the documents on `origin/main` marks as suspect at least 28 of the 30 documents that still describe removed parts, with the reason.
- Unevaluated documents fall from 1,516 to under 50 within the cadence period; missing backlinks fall from 107 to 0; no superseded ADR appears in the governing index or default Find.
- Every reported stop has an owner host and a next action; the Mac no longer reports the shiflo, plen, and digimon stops.
- Freshness cycles that admit nothing fall to under one per hour per repository; resident CPU is reported per repository.
- Prompt hook p95 end to end is under 200 ms; unchanged blocks are never resent within an epoch; base context returns after a detected compaction; tokens per turn and the selected, injected, and used counts are reported for terminal and Discord.
- **Plan ledger replay:** replaying the transcripts of the 2026-11-02 to 2026-11-10 core-loop conversation captures every item in the [core loop roadmap](../../roadmap/core-loop.md), including those absent from the workstream. After a compaction of that conversation, every open item is either in the provider summary or named as a gap. No item closes as `done` without recorded evidence.
