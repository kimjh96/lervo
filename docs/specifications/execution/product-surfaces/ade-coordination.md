# Lervo ADE coordination

Status: `proposed`
As of: 2026-11-27

This specification defines S2h of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): coordination beyond Git. It implements [ADR-0640](../../../decisions/execution/orchestration/0640-coordinate-agents-in-the-workstream-and-let-git-store-and-publish.md) on what [ADR-0205](../../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md) and [ADR-0222](../../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md) already define and the packages implement: path leases, workspace generations, sealing, and integration. It adds only what they lack: leases that grow with the work, a hook that claims a path before the first write to it, changed bytes that keep holding their paths, and commands that seal and integrate.

A conversation claims each path the first time it writes it. A claim that overlaps another agent's lease or another conversation's unintegrated change stops the write and names the holder. The lead seals committed, verified work. Lervo integrates sealed changes into a batch in small steps, and the batch reaches people as one pull request.

## Delivery

| Slice | Delivers                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Readers of event schema 16 (below): the CLI, the Node, and the Hub. `lervo upgrade` targets it once the Hub reads it.                                                                                                                                   |
| 1     | Claims: the conversation's assignment and per-generation workspace record, the claim hook, the core's conflict judgment, reconciliation at the turn's end and at the session's exit, renewal and expiry, and refusals with their message and room line. |
| 2     | Sealing: `lervo workspace seal`, sealed paths that conflict until they integrate, the next generation in the same worktree, superseding a conflicted generation, retiring, and the holder's side of a refusal.                                          |
| 3     | The integration command: `lervo integration`, Lervo's integrator, the batch branch as base and target, and its one pull request.                                                                                                                        |
| 4     | The ADE drives integration: the cadence, the lines, the amber sign, and the sidebar's pull request row, each shown to the owner as a mockup first ([ADR-0642](../../../decisions/execution/applications/0642-improve-the-ade-in-daily-use.md)).         |

Slice 1 also delivers the part of S2c that ADR-0637 orders there: the workspace holds an assignment and a growing lease. The order follows ADR-0637: this specification, then the integration command, then the ADE driving integration.

Slice 1 ships in parts behind one gate: the coordination stage of `lervo workspace start` runs only when this release enables it and the writer selects schema 16. Schema 16 also carries conversation notes, so it may be activated before claims are complete. The release's switch stays off until the claim handler, the turn's reconciliation, and retiring a conversation's assignment and generation record have landed. With the gate closed, the start reports `coordination_inactive`, as below schema 16.

The gate belongs to the repository, not to a process, so the start and every claim in a repository agree. A served hook runs in the resident's context server, whose environment the session does not set. The gate is open for a repository when any of these holds:

- this release's switch is on;
- `LERVO_COORDINATION=1` is set in the deciding process, which tests use;
- an owner-only regular file named `enabled` sits in the repository instance's coordination home, beside the claim path key: `<Git common directory>/lervo-coordination-v1/enabled`. A canary opens the gate this way. A file that others can read or write, a link, or a home that does not exist yet keeps the gate closed.

The core's slices (the workforce, the workspace records, sealing, integration, and the schema 16 readers) and the hook and ADE slices (the claim handler, the canary, the room lines, and the ADE) are built against the claim contract below, which ships first.

## What exists and what this adds

The owner's rule for the ADE is to build on the core's mechanisms and to give a reason for each new one ([rule](../../../instructions/generated/rule_5793ebf6ffa6982e41f8f85b.md)).

| Need                   | What exists                                                                                                                                                                                                                           | What S2h adds, and why                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path exclusion         | `repositoryPathScopesOverlap`: exact and ancestor paths overlap, and `.` and `*` overlap every path (ADR-0205).                                                                                                                       | Nothing. Claims use the same policy.                                                                                                                                      |
| Holding paths          | An assignment's `expectedPaths`, at most 128, under one lease with a generation. Creation requires at least one path, and no transition adds a path to a live lease: amendment only narrows an unstarted one.                         | A conversation assignment that starts with no paths and a transition that widens its live lease, because a conversation does not know its paths up front.                 |
| Conflicts              | `claimAssignment` refuses an overlap with another live write lease, and fails the whole claim when one path overlaps.                                                                                                                 | Unsealed and sealed but unintegrated conversation changes as conflicts for every claim, because a lease expires while the change it protected is still in a worktree.     |
| A check before a write | Managed runs authorize writes through `ProviderManagedWriteBridge`, a `PreToolUse` hook of the Claude Agent SDK. A hosted session's terminal hooks answer only `SessionStart`, `UserPromptSubmit`, and `Stop`.                        | A claim handler in the provider CLI's own settings, because hosted and terminal sessions run the provider CLI, not the SDK.                                               |
| A workspace generation | `lervo workspace start` provisions the worktree through ADR-0222's Git host adapter and writes its ownership marker as generation 1, but records no workspace, assignment, or lease. A workspace record is keyed by its workspace ID. | One record per generation of a conversation's checkout, bound to the generation's assignment, because a sealed generation waits for integration while the next one works. |
| Changes outside scope  | A worker's `Stop` partitions changed paths and blocks on any outside its assignment.                                                                                                                                                  | A conversation's `Stop` claims those paths and blocks only on a conflict.                                                                                                 |
| Sealing, integration   | `planWorkspaceSeal`, `applyWorkspaceSeal`, and the integration plan, apply, verification, and completion in `@lervo/orchestrator`. Knowledge convergence is their only production caller.                                             | `lervo workspace seal` and `lervo integration`, which the [agent workspace specification](../agent-workspaces.md) plans.                                                  |
| Publication            | Knowledge publication's forge port and its GitHub CLI adapter, in `repository-knowledge-runtime`, keep one pull request for a Lervo branch.                                                                                           | The same port, moved to a neutral package, for the batch's pull request.                                                                                                  |
| Room lines             | `lervo_notice` items: a code with parameters, rendered from the ADE's catalog.                                                                                                                                                        | New codes.                                                                                                                                                                |

## Terms

- **Lead**: the conversation's first participant, whose session writes in its worktree ([Lervo ADE rooms](ade-rooms.md)).
- **Conversation assignment**: an ADR-0205 assignment with task type `repository.conversation`. It holds the conversation's lease for one workspace generation.
- **Claim**: adding a path to the conversation assignment's lease before a session in its worktree writes it.
- **Changed paths**: the paths a generation's worktree changed since the generation's base, as the latest reconciliation recorded them.
- **Holder**: the agent whose live lease, unsealed changed paths, or sealed change awaiting integration covers a path.
- **Batch**: the integrated changes on one branch, `lervo/batch/<6 hex>`, that one pull request carries to people.

## The conversation's assignment and workspace

`lervo workspace start` with a lead (S2c) gains a coordination stage after its workstream stage. When the registered repository's writer selects schema 16 and the repository is not Hub-coordinated, the stage:

1. Creates the conversation assignment: the lead's role, version, and contract hash, `accessMode: write`, no expected paths, the workspace's workstream, priority 50, the acceptance criterion "The conversation's sealed change passes its verification.", and the suite that `resolveAutomaticVerificationSuite` selects, or none when the project configures none.
2. Claims it for the lead with the lead session's writer session ID (`ses_terminal_` and 24 hex from the provider session) and a 10-minute lease.
3. Records workspace generation 1 in state `ready`, bound to the marker the start wrote. Its base is the branch head after the replay, so carried knowledge commits are not part of the conversation's change. Its integration target is the open batch branch, or the default branch when no batch is open.
4. Writes the claim handler into the worktree's local provider settings (below).

The events are the existing `assignment.created`, `assignment.claimed`, and `agent.workspace.provisioned`, and `agent.workspace.state.changed` for the move to `ready`. The start result gains `coordination`: `active`, `inactive` with a code (`coordination_inactive` below schema 16 or while the gate under "Delivery" is closed, `hub_coordinated_unsupported` for a Hub-coordinated repository), or `unavailable` with the code `coordination_unavailable` and the failed step's code as `cause`, lowercase. In the last two cases the conversation writes without claims, as it does today, and `unavailable` shows one line. A start without a lead has no stage and no `coordination`. The session-host contract keeps `status`, `code`, and `cause` open strings, so a later CLI's value never fails an older ADE's start.

- **Order.** The stage runs after the launch is prepared and recorded, so no later stage's failure has to give back a lease or a workspace record. Its failure never fails the start.
- **Hub coordination.** A repository is Hub-coordinated when its project enables Hub sync and a Node of this host is registered for it whose configuration sets `workspaceCoordination`. A repository without Hub sync, or without a Node here, is local-first. A Node whose configuration cannot be read makes the stage `unavailable`.
- **Reads before writes.** The stage first reads the marker the start wrote, the active lead, a clean checkout bound to that marker at its post-replay head, the integration target, and the suite. A failure there writes nothing. Then it creates the assignment, claims it, and records the generation, in that order. A failed claim cancels the still-queued assignment (`assignment.cancelled`, reason `requested`); when that cancellation fails too, the cause is `coordination_assignment_stranded` and the queued assignment, with no paths, remains. A failed record leaves the claimed assignment, which holds no path and whose lease lapses within 10 minutes, with nothing referring to it. A failed move to `ready` also leaves generation 1's record in `provisioning`, which root resolution reads as the conversation's.
- **The suite.** A project with no `.lervo/verifications` suite gets an assignment with no suite, which only a conversation assignment may have. A project whose suites leave the automatic choice ambiguous makes the stage `unavailable`.
- **The target.** Until slice 3 opens batches, the integration target digest is that of `refs/heads/<default branch>`.
- **Before slice 1's hook and `Stop`.** A session in a conversation's worktree attaches no worker binding and keeps the cached base, as any linked worktree's session does.
- **Retiring.** `lervo workspace retire` does not yet cancel the conversation assignment or move the generation record to `removed`. Cancellation refuses a live lease today, so it needs the holder-bound cancellation under "Lease lifetime". Until both land the gate stays closed.

A new conversation starts from the open batch's tip when a batch is open, and from the default branch's upstream tip otherwise. A change that integrated into the batch but has not merged is then already in the new conversation's base.

### One record per generation

A workspace record today is keyed by its workspace ID alone, and the integration plan needs a sealed generation to stay `integration_pending` while the conversation works on. Each generation therefore gets its own record:

- The record's ID is derived from the conversation's workspace ID and the generation: `wsp_` and the first 24 hex digits of the SHA-256 of `lervo.conversation.workspace.v1`, the conversation's workspace ID, and the generation in decimal, joined by NUL. Every generation of one checkout shares the checkout's `pathDigest` and records its conversation's workspace ID as `conversationId`, with `kind: conversation` and `executionKind: worker`. A record without `kind` is a worker's. A checkout's newest live record must be an earlier generation of the same conversation before another generation is recorded.
- The checkout's ownership marker names its newest generation by that generation's record ID, so every reader that rebuilds a marker from a record, such as sealing, integration, and cleanup, matches it. `lervo workspace start` writes generation 1's marker that way whether or not coordination is active. The next generation replaces the marker by compare-and-swap; the Git adapter creates markers exclusively today and gains that replacement. The replacement holds a lock file beside the marker and replaces the marker atomically and durably only while it is exactly the expected one; a marker that changed refuses with `host_marker_mismatch`.
  - The lock names a random token, its process, its host, and its creation time, and is written whole to a temporary file that is then linked into place, so it is never empty.
  - A lock of another host, or one younger than 60 seconds, is live and refuses with `host_operation_in_progress`. An older lock of this host whose process is gone is stale. An empty or unreadable lock is stale once it is 5 seconds old.
  - One taker at a time replaces a stale lock, under a short takeover lock: it rechecks that the lock still holds the bytes it judged stale, renames its own lock over it, and reads it back before it touches the marker. A release removes the lock only while it holds the releaser's token.
- A conversation record's path digest is that of the worktree's real path, and so is the marker's. Readers find a checkout by the digest of its path as given or of its real path, so a session that reaches the worktree through a symbolic link finds its record, and worker records, which digest the path as given, are found as before.
- Root resolution, workspace attach, `lervo workspace inspect`, and cleanup take the newest record of a checkout that is not `removed`: the highest generation, then the latest creation. An older generation's record never makes its checkout cleanup-eligible while a newer one lives; automatic cleanup holds it as `newer_generation_live`. A worker's checkout has one record, so its readers behave as before, and inspection still lists every live record of a worker's checkout so a shared one shows.
- `resolveTerminalRoots` gives a conversation workspace ADR-0633's two roots, keyed on `kind: conversation`, so worker workspaces keep their single root.

### Settlements for conversation workspaces

ADR-0637 left three settlements to the S2c specification, and [Lervo ADE agents](ade-agents.md) has not made them. S2h needs them, so this specification makes them for conversation workspaces:

- The session keeps ADR-0633's two roots, as above.
- Owner-instruction capture stays on for the owner's prompts only. A lead's prompt can be a turn the room delivered from another agent ([ADR-0641](../../../decisions/coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md)), so the core keeps each delivery's text digest with its session, and the prompt hook captures nothing from a prompt whose digest matches a delivery.
- `Stop` keeps the checks a linked worktree's `Stop` runs today. It then reconciles claims, inspects the workspace, and pauses it, as a worker's `Stop` does. Reconciliation comes before inspection, so the checkpoint records the assignment's current revision.

### Conversations from before S2h

`lervo workspace open` runs the same stage for a conversation without an assignment. Its worktree may hold uncommitted work and has no recorded base, so the stage records generation 1 with the merge base of its head and the default branch's upstream tip as its base. The record goes directly to `active` with the reason `conversation_adopted`, skipping `ready`'s clean-checkout check. The stage then reconciles every changed path as a turn's end does.

## Leases that grow with the work

A conversation's lease starts empty and grows by one claim at a time, so it holds the paths the conversation has written and nothing it has not.

### What a claim names

- A repository-relative path, normalized as the workforce's path policy requires: no leading `/`, no `.` or `..` segment, no backslash or NUL. The handler resolves the tool's path against the session's working directory and the worktree's root.
- A file tool claims the file. A shell operation on a directory, such as a recursive remove, claims the directory, which covers every path below it. A glob operand claims the deepest directory before its first wildcard, such as `src/net` for `src/net/*.ts`.
- These claim nothing: paths outside every checkout of the repository, paths Git ignores (one `git check-ignore` per request), and Lervo's runtime paths `.lervo/state`, `.lervo/data`, and `.lervo/run`, which no sealed change may contain.
- A target inside another checkout of the same Git common directory, such as the owner's main checkout reached through an absolute path, is refused with `path_outside_workspace`. A write there would bypass both the claim and the seal and could overwrite the owner's own bytes.
- Where Git's `core.ignorecase` is true, a path that matches a tracked file ignoring case is claimed with the tracked spelling. The handler gets it from the filesystem: it resolves each target through the real path of its nearest existing ancestor, which on a case-insensitive filesystem takes the spelling on disk, and that is a tracked file's spelling. A tracked file deleted from the worktree keeps the spelling the tool gave.
- A claim never names `.` or `*`, which would block every other agent.

### Where the handler runs

The handler is a `PreToolUse` hook of the provider CLI with the matcher `Edit|Write|MultiEdit|NotebookEdit|Bash` and a 10-second timeout. It runs the terminal hook command, which a host launcher sends to the resident's context server as the socket's `tool` kind, or runs in process when no server takes it. ([Resident context socket](../stage-observation-and-performance/compact-terminal-context/resident-context-socket.md) gains that kind and a launcher version before any session installs the handler.)

- `lervo workspace start` writes it into a Lervo-managed block of the worktree's `.claude/settings.local.json`. The repository's `info/exclude` gains a Lervo-managed block for that file, so it never appears as a change. Any Claude Code session in the worktree, hosted or the owner's own terminal, therefore claims: ADR-0632 principle 6 keeps the guarantee from living only in the ADE.
  - Lervo's block in the settings is the one `PreToolUse` group whose handler runs the terminal hook command with `--claim`. Each start replaces it, and every other entry stays the user's. The exclude block is `# lervo:begin claim-handler schema=1` through `# lervo:end claim-handler`, and it is written before the settings.
  - The start skips the write and leaves the file as it was when the file is tracked (`settings_tracked`), is not a plain file within 1 MiB (`settings_unsafe`), does not parse as settings (`settings_unreadable`, `invalid_hook_shape`), or has a group that runs Lervo's handler beside one of the user's (`handler_shared`). It also skips when `info/exclude` is not a plain file (`exclude_unsafe`) or a write fails (`write_failed`). A skip leaves `coordination` `active`: a hosted session then carries the handler in its own settings, and the turn's end claims what the owner's own terminal changed.
  - The handler's tools come from the provider adapter's `claimTools`, so the matcher and the tools the adapter reads stay one list.
- A hosted launch adds the handler to its session-scoped settings only when the worktree's settings lack it, as Lervo's other terminal hooks already do, so no call runs Lervo twice. The start runs the coordination stage last, after its session's settings are written, so the handler it writes into the worktree serves the first session. A reopened conversation whose newest workspace record exists claims: its launch adds the handler when the worktree lost it.
- The project's committed hooks do not gain it. A session in a checkout that no conversation owns holds no assignment, and ADR-0222 keeps unattached terminals repository-wide.
- The guarantee holds among writers that claim. A process that writes without a provider hook, such as an editor, is found by reconciliation, not stopped.

The handler finds the conversation from the session's hosted launch record. A joined agent's launch record has `access: read`, so it never claims, and its tool allowlist already refuses writes. A session without a launch record, such as the owner's terminal, finds the conversation from the worktree's workspace record and claims under the conversation's assignment, as the lead's session does. When S2e lands, its `terminal.tool.observed` shares this handler; a reader's call is then observed and never claimed.

### What the handler reads

| Tool                         | Paths claimed                                |
| ---------------------------- | -------------------------------------------- |
| `Edit`, `Write`, `MultiEdit` | `file_path`                                  |
| `NotebookEdit`               | `notebook_path`                              |
| `Bash`                       | The targets command detection finds, or none |

The handler reads only those fields, never `content`, `old_string`, `new_string`, or `edits`. Command detection splits the command at `;`, `&&`, `||`, `|`, and line ends, outside quotes. It follows a leading `cd <dir>`, skips input redirections, and recognizes these forms:

| Form                                                                                                                            | Claims                                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Redirection `>`, `>>`, `>\|`, `>&`, `&>`, or `&>>`, with or without a descriptor such as `1>` or `2>`, to a path outside `/dev` | The file; `2>&1`, `>&2`, and `>&-` name descriptors and claim nothing |
| `tee [-a] <files>`                                                                                                              | Each file                                                             |
| `touch`, `mkdir`, `rm`, `rmdir`                                                                                                 | Each operand; a directory claims the directory                        |
| `mv <sources> <target>`                                                                                                         | Each source and the target                                            |
| `cp <sources> <target>`                                                                                                         | The target                                                            |
| `sed -i`, `perl -i`                                                                                                             | Each file operand                                                     |
| `git mv`, `git rm`                                                                                                              | Each operand                                                          |

An operand that contains `$`, a backquote, or a leading `~` is undetected. `git checkout ... -- <paths>` and `git restore` claim nothing: they return paths toward committed bytes, and reconciliation judges the result. Every other write, such as a formatter, a generator, a package manager, `git apply`, a branch switch, or an MCP tool that writes files, is undetected, and the turn's end claims what it changed.

A request whose paths all sit inside a lease that expires more than 30 seconds from now answers `allow` after reading the conversation's own assignment, without the scheduler lock. A request that detects no target and nothing undetected answers `allow` without reading state.

### How the handler decides

`decideClaim` implements the core level of the claim contract below. Slice 1 delivers it before the turn's reconciliation, so its refusals stop writes while unsealed changed paths are not yet recorded.

- **Finding the conversation.** A lead's launch record names the conversation, and the lead claims with its own writer session, `ses_terminal_` and 24 hex digits of its provider session. A launch record of a joined agent, or of a conversation started without agents, claims nothing. A session without any launch record finds the conversation from its checkout's newest workspace record and claims with the lease's own agent and writer session, so the owner's terminal widens the same lease the lead's session does. A main checkout has no conversation and spawns no Git. Once it knows the repository, the handler reads its gate under "Delivery" before any workspace record; a closed gate, or a checkout without a conversation record, as below schema 16, claims nothing.
- **Order.** The handler locates the targets first. A target inside another checkout denies the whole request. A request whose targets all sit inside the conversation's own lease, held by the same agent and writer session with more than 30 seconds left, answers `allow` without the scheduler lock and without renewing the lease. Only then does it run `git check-ignore` once, on the targets the lease does not hold.
- **The scheduler lock and the hook's exit.** Immediately before each lock is taken, the widening checks that the hook has not answered without it and that more than 500 ms remain before the 2-second deadline; otherwise it stops there and defers. A widening that took the lock always finishes: the hook answers, then waits up to 5 seconds for it before it returns, so an in-process hook never exits holding the lock or leaving widened bytes without their event. A served hook answers first, and the context server counts the widening as the request's own work and drains it before the next request.
- **Targets that claim nothing.** The worktree itself, `.git` and below, Lervo's runtime paths, ignored paths, and paths outside every checkout. Other checkouts come from one `git worktree list`, run only when a target is outside the worktree. A directory is checked against ignore rules with a trailing `/`, so a directory pattern matches a directory a command is about to create. A failed `git check-ignore` keeps every target.
- **Other checkouts.** Claiming nothing wins over `path_outside_workspace`. A target in another checkout that would claim nothing there, because it is under that checkout's `.git` or Lervo's runtime paths or Git ignores it there, is allowed. Only the rest are refused, and the other checkout's root is always refused. A link whose target does not exist yet is followed through `readlink`, so a link in the worktree that points into another checkout is judged by where it points.
- **One denial per request.** A request claims all or none, so every refusal stops the write and records its event. The denial names the first refusal's code and holder, sorted by path, and every path that holder refused for that code. The claim log keeps one entry for each holder's refusal, the named one last, so a tool use's entry is the one the message named. Two hooks of one session that race may both miss each other's entry and record one extra event; the log's readers tolerate that.
- **The holder.** For a lease held by a conversation assignment, `workspaceId` is that conversation's workspace ID, found from the workspace record bound to the assignment. `conversationTitle` is the workstream title in the worktree of the conversation's newest generation. `until` is the holder's lease expiry. The agent registry gives the display name and origin, and the project's roles give the role name. An agent record that is gone or unreadable leaves the holder's origin `unknown`: the message names its agent ID and mentions nobody. Names and the title reach the message on one line without control characters, at most 80 characters each. The widening fills the same workspace ID into the event's `holderWorkspaceId`. A lease of an assignment that is not a conversation's names no workspace.
- **Changed paths.** Other conversations' sealed changes hold their paths through `path_awaiting_integration` from the sealed result's changed paths. Unsealed changed paths hold nothing until the turn's reconciliation records them on the workspace record.
- **One event per turn.** Before it records `assignment.claim.refused`, the handler reads the claim log's refusals of the session since the session's open-turn marker. It skips a path and holder agent already recorded. A session without an open turn or a readable log skips nothing. `path_outside_workspace` records the event too, with null holder fields, when the store takes schema 16 envelopes. A refusal the hook never delivered, because it had already answered `defer` and the write went ahead, records no event.
- **Deferral codes.** A failure defers with its code, such as `workforce_busy` or `assignment_lease_conflict` for an expired or another session's lease, or `claim_deferred` when it has none. A widening whose event failed defers with the event's cause. The claim opens the event store with a 250 ms busy wait instead of SQLite's 5 seconds, because the event is written under the scheduler lock, and a store another writer holds defers as `workforce_busy`. A store that no longer takes schema 16 envelopes answers `allow`, since no lease grows there.
- **Cost.** Measured on macOS with the hook in process, as medians:
  - in a main checkout, about 0.2 ms, with no Git;
  - in a conversation's worktree with the gate closed, about 17 ms, most of it the `git rev-parse` that finds the coordination home for the gate file;
  - inside the lease, about 22 ms with the gate open in the process and about 55 ms with the gate file, each `git rev-parse` that resolves the coordination home costing about 15 ms;
  - a widening, 100 to 200 ms.

### How a claim widens the lease

A claim of a new path takes the workforce's scheduler lock, ADR-0205's short critical section, and:

1. Rereads the conversation assignment and checks that its lease is current, that the lead is active, and that the lead's responsibility paths cover the path.
2. Judges conflicts, as the next section defines.
3. Adds the paths, extends the lease to 10 minutes from now, and advances the assignment's revision. The lease generation stays, so the workspace generation's binding stays current.
4. Records `assignment.lease.widened`. A failed event restores the assignment's bytes, as every workforce transition does, and the request answers `defer`.

The targets of one hook request are claimed in one transition, all or none. Reconciliation claims the conflict-free part of its paths and reports only the conflicts.

A conversation assignment holds at most 10,000 entries, the bound of a sealed result's changed paths, instead of the 128 that bound other assignments. Past that, Lervo coalesces as a last resort: the candidates are the directories, below the root, that hold a new path or an entry. Lervo takes the deepest candidate that covers at least two entries and overlaps no other holder, breaking ties by path order, replaces the entries below it, and repeats until the set fits. When no candidate fits, the claim is refused with `lease_path_limit`.

A coalesced directory also stays inside the lead's responsibility paths, so coalescing never takes a path that a claim could not. A widened record that would pass 1.5 MiB is refused with `lease_path_limit` too, which leaves room below the workforce's 2 MiB state-file bound for the assignment's later writes. Reconciliation past the bound claims none of a chunk's conflict-free part (below) rather than an arbitrary share of it. A claim moves the expiry to 10 minutes from now and never shortens a longer renewal. A claim of paths the lease already holds renews it with `assignment.lease.renewed` when less than 5 minutes remain, because `assignment.lease.widened` always adds at least one entry.

Released readers accept at most 128 expected paths, so slice 1 writes at most 128 entries into a conversation's lease and coalesces at 128, while its readers accept 10,000. A later release raises the write bound to 10,000 once every reader in the fleet reads it. One widening call judges at most 2,000 paths in one scheduler lock hold; a larger reconciliation runs in chunks of 2,000, each its own hold. A call records at most 32 `assignment.claim.refused` events and counts the rest.

Each refused path and holder records one `assignment.claim.refused`. A refusal whose event fails still stops its write: the transition reports the failed event rather than allowing the write.

## Conflicts

The core judges conflicts in one place, for every claim: a conversation's claim, reconciliation, and `claimAssignment` for every other assignment, including Lervo's own agents. A path conflicts when, at that moment:

- another assignment's live write lease overlaps it, under ADR-0205's rule and regardless of role (`path_leased`). A knowledge convergence writer's lease on a document stops a conversation's write to it, and the reverse holds too;
- another conversation's generation in `ready`, `active`, or `paused` changed it since its base and has not sealed it (`path_changed_unsealed`). Changed bytes hold their paths whether or not the lease is live, so a conversation that stopped, or whose session the session host stopped while idle, never loses the work in its worktree. A lease's expiry frees only paths it claimed but never changed;
- another conversation's sealed generation changed it and has not integrated: its state is `sealed`, `integration_pending`, `integrating`, or `integration_conflict` (`path_awaiting_integration`).

The conversation's own generations never count, because its next generation starts from their head. Neither does the integrator's lease over the conversation's own sealed generations, so integrating a conversation's change never blocks the conversation's next generation.

A claim is also refused when the path is outside the lead's responsibility paths (`outside_responsibility`), inside another checkout (`path_outside_workspace`), or past the lease bound (`lease_path_limit`). Read-only leases never conflict, as today.

Knowledge convergence today holds a stage refused with `assignment_path_conflict` while any live write lease exists, overlapping or not. Conversation leases and changed paths last for hours, so slice 1:

- splits the code: `assignment_path_conflict` keeps meaning an overlap, and a path outside the stage's responsibility gets `assignment_path_outside_responsibility`, which does not wait;
- narrows the hold to a holder that overlaps the stage's paths, judged as above;
- reports a stage held longer than a day as Lervo debt with its age and its holder's conversation ([ADR-0561](../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md)).

## The claim contract

The hook and the core meet at two levels. The adapter level ships first ([#555](https://github.com/kimjh96/lervo/pull/555)).

- **Adapter level**, in `@lervo/adapter-contract`:
  - `HostedWriteIntent`: `toolClass` (`file`, `notebook`, or `shell`), `targets` (absolute paths, each a `file` or a `directory`), and `detection` (`exact`, `parsed`, or `undetected`).
  - `HostedClaimDecision`: `allow`; `deny` with `reason`, the message, at most 2,048 characters; or `defer`.
  - `HostedClaimAnswering`: `writeIntent(toolName, input, workingDirectory)` and `claimAnswer(decision)`, the text the provider's hook prints. An adapter that answers claims also exports them as a light entry, such as `@lervo/adapter-claude/claims`, so the terminal hook runtime loads no adapter runtime.
- **Core level**: `decideClaim(request)`, where the request is the conversation's `workspaceId`, the `agentId`, `providerSessionId`, `toolUseId` or null, and the intent. It answers `allow`; `deny` with `code`, `paths` (repository-relative), `holder`, and `message`; or `defer` with `code`. `holder` is `{agentId, displayName, roleName, origin, workspaceId, conversationTitle, kind, until}` or null, where `kind` is `lease`, `changed`, or `sealed_change` and `until` is the lease's expiry or null. The hook writes the claim log entry and passes `message` to the adapter as the denial's reason.
- **The deadline**: finding the conversation and deciding share 2 seconds. Past that, or on any failure other than a refusal, the hook answers `defer`.

The Claude Code adapter answers this way:

- `deny`: the handler prints `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": <message>}}` and exits 0. Claude Code skips the tool and gives the reason to the model.
- `allow` and `defer`: the handler prints `{}` and exits 0. It never answers `"allow"`, which would skip the permission settings of a CLI conversation, where the owner answers prompts.
- A deny holds in `bypassPermissions`, the mode native hosted sessions run in. A canary on 2026-11-27 with Claude Code 2.1.330 in print mode, `--permission-mode bypassPermissions`, and a session settings file whose handler denied every target containing `guarded`:
  - A denied `Write`, a denied `Bash` redirection, and a denied `Edit` of an existing file left no file and the existing file's bytes unchanged, and the model reported the reason.
  - A `general-purpose` subagent's `Write` ran the same handler with the parent's `session_id`, plus `agent_id` and `agent_type`. Its denied write left no file and its allowed write succeeded. A subagent's claims are therefore its conversation's.

### The message

The message is one paragraph: what stopped, the path, the holder, until when, why, what to do, and where the holder works. The holder's conversation comes last, so a message cut at its bound never loses what to do. For `path_leased`:

> Lervo stopped this write. `src/retry.ts` is claimed by Arin (Developer) until 14:32. Two agents changing one path in parallel conflict when their work integrates. Do not write this path another way. Mention @Arin with the change you need, continue with other paths, or try again after Arin's change is sealed. Arin works in the conversation "Log format".

- When Lervo's own agent holds the path, the message names "Lervo's knowledge maintenance" and offers only other paths or the time, because Lervo's agents are never mentioned.
- For `path_changed_unsealed`, it names the conversation whose worktree changed the path and offers the same choices without a time.
- For `path_awaiting_integration`, it names the sealed change's conversation and says to try again once the change integrates.
- For `outside_responsibility`, it says to mention an agent whose responsibility covers the path.
- For `path_outside_workspace`, it says to write inside the conversation's own worktree.
- For `lease_path_limit`, it says to seal the committed part of the change first.

Times are the host's local `HH:MM`.

### What the agent does next

The room block that each session receives ([Lervo ADE rooms](ade-rooms.md), "What each session knows") gains these lines for the lead:

1. A stopped write is not retried another way: reconciliation would find it.
2. When the work needs the change, the agent mentions the holder by name with what it needs. The holder makes the change under its own lease or answers. The product owner is not a router.
3. Otherwise the agent continues with other paths, or ends its turn saying what waits on the holder.
4. Finished, committed work is sealed with `lervo workspace seal --write`, not sent as a pull request of its own.

A mention reaches a holder in another conversation once rooms slice 2 lands. Before that, the agent names the holder in its final message, where the owner reads it.

### What the owner sees

After the stopped tool's line, the conversation shows a quiet room line without a mark: "Ciel was stopped at `src/retry.ts` · Arin holds it in Log format". The decoder adds it as the `lervo_notice` item `claim_conflict` when it decodes the tool's result, from the claim log's entry for that tool use. Slice 2 adds the holder's side, once per path and waiting conversation: "Ciel waits for `src/retry.ts` from Fix retry budget".

### When Lervo cannot decide

A decision that takes longer than 2 seconds, or a claim that fails for any reason other than a refusal, such as `workforce_busy` after the workforce's retries, answers `defer`. The write goes ahead, the claim log records the path as deferred, and the turn's end claims it. The conversation shows one line per turn: "Lervo checks this turn's claims at its end (workforce_busy)". A write never waits on Lervo's own failure, which keeps hooks off the developer's critical path ([ADR-0451](../../../decisions/knowledge/repository/canonicalization/0451-keep-terminal-hooks-off-the-developer-critical-path.md)); reconciliation keeps the guarantee.

## Reconciliation

Reconciliation lists the paths the generation changed since its base: committed, staged, unstaged, and untracked paths that Git does not ignore. It records them as the generation's changed paths, claims the conflict-free ones outside the lease in one transition, and reports each conflict. It runs at the conversation's `Stop`, when the resident observes `session.exited` for the lead's session (a crash runs no `Stop`), and at a seal request.

- At `Stop`, a conflict blocks once, with a message naming each path and its holder. Before the message suggests returning a path to its base bytes, such as `git restore --source=<base> --staged --worktree -- src/retry.ts`, Lervo saves the path's current bytes as a commit under `refs/lervo/backup/<workspace>/<claim>`, so the suggested restore is reversible. A conversation keeps at most 32 backup refs, and each is removed 7 days after its path resolved.
- When `Stop` runs again with `stop_hook_active` and a conflict remains, it lets the turn end and records the path as `unresolved`. The conversation shows "`src/retry.ts` changed without a claim · Arin holds it" with the amber sign.
- Sealing refuses while a path stays unresolved (`seal_paths_conflict`). A later reconciliation that finds the path back at its base, or claims it once the holder released it, resolves it.

## Lease lifetime

- **Duration.** A conversation lease runs 10 minutes from its last claim or renewal, inside the existing bounds of 5 seconds to 30 minutes.
- **Renewal.** The resident renews each conversation lease every 4 minutes while it holds a decoder for the lead's session and has no `session.exited` report for it, and while a seal request of the conversation is pending. Each prompt, claim, and `Stop` of a session in the worktree also renews when less than 5 minutes remain, so hooks that run without the resident keep the lease. A renewal is the existing `assignment.lease.renewed`, unchanged.
- **Expiry.** A session that exits, crashes, or is stopped while idle stops renewing, and its lease expires at most 10 minutes later. Expiry frees only the paths the generation claimed and never changed; its changed paths keep holding through `path_changed_unsealed`. Expiry changes no workspace state (ADR-0222).
- **Coming back after expiry.** A session's next prompt or claim in the worktree reacquires the assignment under the scheduler lock with the next lease generation, keeping every path no other holder claimed meanwhile. The workspace adopts the new lease generation on its next activation, with the reason `lease_regenerated`. Neither step exists today: `claimAssignment` fails the whole claim when one path overlaps, and a workspace record cannot change its lease generation.
- **Release when sealed.** Sealing completes the assignment (`assignment.completed`), which ends its lease. Until the sealed change integrates, its paths conflict for every claim through `path_awaiting_integration`, so the release opens no window, for another conversation or for Lervo's own agents.
- **Release when retired.** Retiring cancels the conversation assignment (`assignment.cancelled`, reason `requested`). Cancellation refuses a live lease today (`active_lease`), so the retire passes the holder's exact agent and lease, a holder-bound form of cancellation. Retire refuses with `workspace_integration_pending` while a sealed generation of the conversation waits for integration.
- **Across hosts.** A lease coordinates one repository instance through its Git common directory. A Hub-coordinated repository reserves paths at the Hub before a local claim (ADR-0222), which a growing lease would break, so its conversations stay `inactive` (`hub_coordinated_unsupported`) until Hub reservations grow with the lease.
- **Archiving.** A completed or cancelled conversation assignment whose generation integrated or was removed is archived as convergence's assignments are, so finished conversations never push the workforce toward its 10,000-assignment bound or slow the claims that read every assignment.

## Sealing

For an ADE conversation, a sealed change is its committed work as one immutable ADR-0222 generation: the base and head commits, the tree, the changed paths, all inside the lease and none unresolved, a passed result for each suite the assignment names, and a result artifact. Lervo never commits; the lead or the owner does.

1. The lead runs `lervo workspace seal --write` when the owner says the work is done, or when it has finished and committed a coherent change. The command reconciles, checks that the checkout is clean and nothing is unresolved, records a seal request for the current head and tree with that clean-checkout evidence, and returns at once. A refusal names its code.
2. Verification runs in an isolated worktree of the requested head, prepared as [ADR-0625](../../../decisions/execution/verification/0625-prepare-isolated-candidate-verification-workspaces.md) prepares one, so it never waits inside a turn or a tool's timeout.
3. Once verification passes and the turn has ended, the resident applies the seal from `paused`. The state machine already allows `paused -> sealing`. `planWorkspaceSeal` accepts only an `active` workspace whose writer session matches today. It gains `paused`, where the writer session is null, with the seal request naming the assignment's exact lease instead. The seal completes the assignment with the result artifact, pins the sealed head at `refs/lervo/sealed/<workspace>/<generation>` until the generation integrates or is removed, and queues the generation (`integration_pending`).
4. The seal binds to the requested head, its tree, and the clean-checkout evidence recorded with the request. Work after the request, committed on top of the head or not, belongs to the next generation. A head that no longer descends from the requested head, as after a reset or rebase, drops the request (`seal_superseded`). A failed suite drops it too (`seal_verification_failed`), and the next prompt's Lervo context names the suite and its result artifact.
5. After the seal, the conversation continues in the same worktree as the next generation: a new record, a new conversation assignment with no paths, claimed by the lead, and a base at the sealed head. The marker moves to the new generation by compare-and-swap.

## Integration in small steps

- **Batch.** Each project integrates into a batch branch, `lervo/batch/<6 hex>`, created from the default branch's upstream tip. No worktree checks it out, because target advancement refuses a checked-out ref. A batch stays open until its pull request merges; the next integration then starts a new batch. The integration target digest that a generation records is the batch ref's, which is ADR-0222's configured durable target for the generation.
- **Integrator.** Lervo's own agent integrates, with `origin: lervo`, so the sidebar does not show it ([ADR-0643](../../../decisions/execution/orchestration/0643-record-which-agents-are-lervos-own.md)). Its `repository.integration` assignment covers the selected sources' changed paths, and its integration worktree sits under the workspaces home, apart from every conversation. The resident runs it; no provider session takes part, and Git operations stay the exact ones ADR-0222 allows.
- **The command.** `lervo integration queue` lists queued generations. `lervo integration plan` builds a read-only plan of at most 32 sources for the open batch. `lervo integration apply --plan <id> --write` prepares the candidate, verifies it with the project's suite, advances the batch branch by compare-and-swap, and records `assignment.integration.recorded`. `lervo integration resolve` releases an attempt or requeues a reworked source. Each calls the existing orchestrator functions.
- **Cadence.** When a generation is queued and no attempt is open, the resident waits 2 minutes for more seals to join, then integrates. A project without a suite does not integrate (`verification_unconfigured`); its sealed changes wait, and the sidebar's batch row says so.
- **Conflict.** A conflict records `integration_conflict` and keeps the sealed generation, as ADR-0222 defines. The conversation shows "Integration conflict with Fix retry budget" with the amber sign. The lead's next prompt's Lervo context names the other conversation and the batch branch, so the lead can update its branch from the batch and seal again. Until then the generation's paths keep conflicting.
- **Superseding.** When the conversation seals a later generation whose head descends from a conflicted generation's head, the conflicted generation moves to `recovery_required` with the reason `generation_superseded` and then to `removed`, which frees its paths without touching the checkout. The later generation then integrates from the superseded generation's base, so the batch receives both changes.
- **Publication.** After an integration, Lervo pushes the batch branch and opens or updates one pull request from it to the default branch, through the forge port, which moves from `repository-knowledge-runtime` to a neutral package. The body lists each integrated conversation's title, lead, sealed head, and verification result. Pushes happen at most once every 10 minutes while integrations continue, which bounds the repository's CI runs for a batch. Lervo never merges the pull request and never force-pushes: a push that is not a fast-forward stops with `publication_diverged`. Missing credentials or a missing remote are notice-only (`publication_credentials_missing`): integration goes on locally, and the pull request waits.
- **A closed batch.** When people close the batch's pull request without merging, Lervo marks the batch abandoned. Its integrated generations move to `recovery_required` with the reason `batch_abandoned`, and each conversation shows one line. The next integration starts a new batch.
- **Consequential effects.** Under ADR-0561, the push and the pull request leave the host. Each is reversible: Lervo pushes only its own batch branch, which deleting removes, and closing the pull request withdraws it. The candidate's verification runs in the integrator's isolated worktree, apart from every conversation's session, and the conversations' lines notify after the fact. Nothing waits on the owner.

## What the ADE shows

The [craft rules](ade-craft.md) apply: finished work shows nothing, and only what needs the person adds a sign.

- **In the conversation.** The turn summary counts the turn's new claims, "Claimed 3 paths". Quiet room lines without a mark show refusals, unresolved and deferred claims, "Claims widened to `src/net/`", "Sealed · 4 files", "Seal verification failed (repository.default.v9)", "Integrated into pull request #812", and integration conflicts. Paths show whole and relative to the repository, never cut off (rule 8).
- **The amber sign.** An unresolved path or an integration conflict adds the still amber dot beside the conversation (rule 21) until it resolves. Nothing else adds a sign.
- **The sidebar.** While a batch pull request is open, one quiet row below the conversations names it, "Pull request #812 · 3 conversations", and opens it in the browser.

## Read-access participants

- A joined agent's session runs with read access ([Lervo ADE rooms](ade-rooms.md)). It claims nothing and holds no assignment or lease: its launch record says `access: read`, and its tool allowlist already refuses writes. A read-only lease would grant nothing and block nothing.
- A joined agent that needs to write does not become a second writer; ADR-0222 keeps one writer per generation. It mentions the lead with the change it needs. When the work is its own, it starts its own conversation, as rooms slice 2 defines (`workspace.start` with `startedBy`). That conversation gets its own workspace generation, assignment, and growing lease, and its claims conflict with the first conversation's like any other's.
- A test run writes build output that Git ignores, which claims nothing. Whether a read-access session may run tests is therefore a question of its tool allowlist alone, which settles S2h's part of the [rooms open item](ade-rooms.md#open-items).

## State, events, privacy, and failure meaning

- **State.**
  - The conversation assignments and the workspace records live in the coordination home under the Git common directory, as every assignment and workspace does. A workspace record gains `conversationId`, `kind`, and the generation's changed paths, at most 10,000. Each holds repository-relative paths as owner-only state that nothing publishes.
  - The claim path secret is 32 random bytes in the repository instance's coordination home, mode 0600, beside the coordination records that every checkout of the instance shares: `<Git common directory>/lervo-coordination-v1/claim-path-key`, or `.lervo/data/repository-coordination-v1/claim-path-key` in a checkout outside Git, whose `data/` the `.lervo/.gitignore` that `lervo init` writes excludes. Git never tracks it, and nothing publishes or replicates it. Its first use writes it whole to a private temporary file and links it into place, so concurrent first uses agree on one key; a temporary file older than a minute, left by a use that stopped, is removed on the next use. A key that is not an owner-only regular file of exactly 32 bytes fails closed with `workforce_state_invalid` and is never replaced, since a new key would make earlier refusals' digests unmatchable. A filesystem without owner-only modes, such as WSL's drvfs, therefore fails closed, and claims there defer.
  - The claim log is host-local operational state beside the hosted launch records, mode 0600, at most 512 entries per conversation with the oldest dropped. Each entry holds `claimId`, `sessionId`, `toolUseId` or null, the decision, the code, the repository-relative paths, the holder's agent and workspace IDs, the state (`refused`, `deferred`, `unresolved`, or `resolved`), and the times. It holds no tool input, command text, or file content.
  - The seal request sits beside the workspace record: the head commit, the tree, the clean-checkout evidence, the request time, and the verification's artifact IDs.
  - Lervo's refs: `refs/lervo/sealed/<workspace>/<generation>` while a sealed generation waits, and at most 32 `refs/lervo/backup/<workspace>/<claim>` per conversation.
- **Reused events.** `assignment.created`, `assignment.claimed`, `assignment.lease.renewed`, `assignment.completed`, and `assignment.cancelled` go to the registered repository's store, never the worktree's. `agent.workspace.provisioned`, `agent.workspace.state.changed`, `agent.workspace.checkpointed`, `agent.workspace.sealed`, `assignment.integration.state.changed`, `assignment.integration.recorded`, and `agent.workspace.removed` stay in the coordination home. Workspace state changes gain the reason codes `lease_regenerated`, `conversation_adopted`, `generation_superseded`, `batch_abandoned`, and `conversation_retired`. With `conversation_retired`, a retired conversation's record moves to `recovery_required` and then `removed`, as a never-used checkout's does.
- **Event schema 16.** [Lervo ADE rooms](ade-rooms.md) took schema 15 for its `room.*` events, and a reader that reports 15 already promises to read every schema 15 payload, so coordination takes 16:
  - `assignment.lease.widened` is new: `assignmentId`, `agentId`, `leaseGeneration`, `revision`, `expectedPathDigest` (the digest `assignment.claimed` uses, over the sorted path set), `expectedPathCount`, `addedPathCount`, `cause` (`claim` or `reconcile`), and `occurredAt`. `assignment.lease.renewed` keeps meaning a moved expiry only.
  - `assignment.claim.refused` is new: `assignmentId`, `agentId`, `leaseGeneration`, `code`, `holderAgentId`, `holderAssignmentId`, `holderWorkspaceId` (each holder field null where none applies), `pathDigest`, `detection` (`tool`, `shell`, or `reconcile`), and `occurredAt`. `pathDigest` is the HMAC-SHA-256 of `lervo.claim.path.v1` and the path, joined by NUL, under the repository instance's local secret, so a replicated event does not reveal a guessable path. It is written `hmac-sha256:` followed by 64 lowercase hex digits, so it never reads as an unkeyed `sha256:` digest. Lervo records at most one per session, holder, and path digest in a turn. It proves that Lervo refused the claim, not that the provider skipped the tool or that the agent stopped. A missing event never means that no conflict happened.
  - Payloads exclude paths, tool input, command text, file content, conversation titles, the message, provider session IDs, and tool use IDs.
- **Activation.** Readers ship first; `lervo upgrade` activates schema 16 only after every configured reader, the Hub included, reports it ([event envelope compatibility](../events-and-privacy/event-envelope-compatibility.md)). A workforce transition without its event does not commit (ADR-0205), so a lease cannot grow below 16: the coordination stage does not run, and conversations write without claims. The CLI's recorder of `assignment.lease.widened`, `assignment.claim.refused`, and a claim's `assignment.lease.renewed` writes schema 16 envelopes to the registered repository's store and refuses with `coordination_inactive` below 16, so such a widening restores its bytes and answers `defer`.

| Code                              | Meaning                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `path_leased`                     | Another assignment's live write lease overlaps the path. The write stopped.                                |
| `path_changed_unsealed`           | Another conversation's worktree changed the path and has not sealed it. The write stopped.                 |
| `path_awaiting_integration`       | Another conversation's sealed change touched the path and has not integrated. The write stopped.           |
| `outside_responsibility`          | The path is outside the lead's responsibility paths. The write stopped.                                    |
| `path_outside_workspace`          | The path is inside another checkout of the repository. The write stopped.                                  |
| `lease_path_limit`                | The lease holds 10,000 entries and cannot coalesce without overlapping another holder. The write stopped.  |
| `claim_deferred`                  | Lervo could not decide within 2 seconds or failed. The write went ahead, and the turn's end claims it.     |
| `claim_unresolved`                | A changed path still conflicted after `Stop`'s second run. Sealing refuses until it resolves.              |
| `coordination_inactive`           | The writer selects a schema below 16, or the stage's gate is closed. Nothing is claimed.                   |
| `hub_coordinated_unsupported`     | The repository is Hub-coordinated. The conversation writes without claims.                                 |
| `coordination_unavailable`        | The start could not create the assignment or the workspace record. The conversation writes without claims. |
| `seal_checkout_not_clean`         | The worktree holds uncommitted changes or untracked files. Nothing was sealed.                             |
| `seal_paths_conflict`             | A changed path is unresolved. Nothing was sealed.                                                          |
| `seal_verification_failed`        | A suite failed on the requested head. Nothing was sealed, and the lease holds.                             |
| `seal_superseded`                 | The head no longer descends from the requested head. Nothing was sealed.                                   |
| `workspace_integration_pending`   | Retire refused while a sealed generation waits for integration. Nothing changed.                           |
| `verification_unconfigured`       | The project configures no suite. Sealed changes wait for integration.                                      |
| `publication_diverged`            | The remote batch branch moved. Lervo pushed nothing and never force-pushes.                                |
| `publication_credentials_missing` | No remote or no signed-in forge client. Integration goes on locally; the pull request waits.               |

## Verification

Each check reads the core's records, not only what the conversation shows.

- **Slice 0.** A reader at schema 15 refuses `assignment.lease.widened` and `assignment.claim.refused`; one at 16 accepts them. `lervo upgrade` does not activate 16 while the Hub reports 15.
- **Slice 1, units.** Path normalization, ignored paths, and case folding; each detected and each undetected command form; a target in another checkout; coalescing past the bound on a fixed set; a widening whose event fails restores the assignment's bytes; a claim inside a lease with more than 30 seconds left takes no lock; reconciliation claims the conflict-free part.
- **Slice 1, the canary gate.** In a native hosted session (stream-json with Lervo's permission prompt tool), a denied `Edit` and a denied `Bash` leave the file unchanged, and a subagent's call carries the parent's session.
- **Slice 1, two conversations in two worktrees of one registered repository.**
  - A's `Edit` of `src/a.ts` records `assignment.lease.widened` with `expectedPathCount: 1` in the repository's store.
  - B's `Edit` of `src/a.ts` is denied, and the file keeps its bytes. The reason names A's lead and conversation, `assignment.claim.refused` names A's assignment, and B's timeline shows `claim_conflict`. B's `Write` of `src/b.ts` succeeds.
  - B's `printf x > src/a.ts` is denied the same way. B's `node -e` write to `src/a.ts` runs, and B's `Stop` blocks once, naming `src/a.ts` and A's lead, after saving a backup ref.
  - With a fake clock, A's lease renews while its process runs and expires 10 minutes after the process exits. B's claim of `src/a.ts` is still refused, now as `path_changed_unsealed`. B's claim of a path A claimed but never changed succeeds. A's resumed session activates with `lease_regenerated`.
  - A's `Edit` of a file in the main checkout through an absolute path is denied as `path_outside_workspace`.
  - The owner's terminal session in A's worktree claims under A's assignment.
  - Both conversations keep recording owner-rule captures and `terminal.turn.observed` in the repository, not in a worktree. A room-delivered prompt records no capture.
  - A knowledge convergence stage held by an overlapping conversation resumes when the conversation seals and integrates, and one that overlaps nothing never waits.
- **Slice 2.** Seal refuses a dirty or unresolved worktree. A passed seal records `agent.workspace.sealed` and `assignment.completed`, and generation 1 stays `integration_pending` while generation 2 is `active`. B's claim of a path that A's sealed change touched is refused with `path_awaiting_integration` until that change integrates, and so is a convergence claim. A turn that writes after the seal request does not change what is sealed. The next generation starts with no paths. Retire refuses while the seal waits and otherwise records `assignment.cancelled`.
- **Slice 3.** Two sealed conversations integrate into one batch with one `assignment.integration.recorded` and one compare-and-swap advance. A fake forge sees one pull request updated, never two. A text conflict records `integration_conflict`, and the source stays sealed; a later generation that contains it supersedes it, and the batch receives both changes. The integrator's lease does not block the sealed conversation's next generation. A new conversation started while the batch is open has the batch's tip as its base. No push forces.
- **Slice 4.** Each line, the amber sign, and the sidebar row are checked in the real app, in light and dark ([craft rules](ade-craft.md), rule 17).

## Open items

- Hub-coordinated growing leases: widening a Hub reservation as the local lease grows, so clones on two hosts coordinate through the Hub, and two hosts pushing one batch branch.
- A claim on a path that an integrated change touched after the workspace's base is allowed. Whether a claim should first require the branch to include the batch is open.
- ADR-0632's S2c check says each session holds its own lease. This specification gives a read-access participant none, because a read-only lease grants and blocks nothing. Whether that check should name only the writer's lease is open.
- The same suite runs at the seal and at integration. Whether the seal can run a lighter one is open, and so is how a project without a suite integrates at all.
- Knowledge publication's pull request and the batch's pull request can change the same document independently, which surfaces only when the second merges.
- A provider whose sessions cannot resume would leave a dead writer in an `active` workspace. Such an adapter needs a recorded pause at the exit before it answers claims.
