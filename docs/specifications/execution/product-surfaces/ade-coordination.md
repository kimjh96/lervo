# Lervo ADE coordination

Status: `proposed`
As of: 2026-11-27

This specification defines S2h of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): coordination beyond Git. It implements [ADR-0640](../../../decisions/execution/orchestration/0640-coordinate-agents-in-the-workstream-and-let-git-store-and-publish.md) on what [ADR-0205](../../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md) and [ADR-0222](../../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md) already define and the packages implement: path leases, workspace generations, sealing, and integration. It adds only what they lack: leases that grow with the work, a hook that claims a path before the first write to it, and commands that seal and integrate.

A conversation's lead session claims each path the first time it writes it. A claim that overlaps another agent's live lease stops the write and names the holder. The lead seals committed, verified work, which releases its lease. Lervo integrates sealed changes into a batch in small steps, and the batch reaches people as one pull request.

## Delivery

| Slice | Delivers                                                                                                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Readers of the next event schema (below): the CLI, the Node, and the Hub. `lervo upgrade` targets it once the Hub reads it.                                                                                                                     |
| 1     | Claims: the conversation's assignment and workspace record, the claim hook for Claude Code, reconciliation at the turn's end, renewal and expiry, refusals with their message and room line.                                                    |
| 2     | Sealing: `lervo workspace seal`, release at the seal, sealed paths that conflict until they integrate, the next generation in the same worktree, retiring, and the holder's side of a refusal.                                                  |
| 3     | The integration command: `lervo integration`, Lervo's integrator, the batch branch, and its one pull request.                                                                                                                                   |
| 4     | The ADE drives integration: the cadence, the lines, the amber sign, and the sidebar's pull request row, each shown to the owner as a mockup first ([ADR-0642](../../../decisions/execution/applications/0642-improve-the-ade-in-daily-use.md)). |

Slice 1 also delivers the part of S2c that ADR-0637 orders there: the workspace holds an assignment and a growing lease. The order follows ADR-0637: this specification, then the integration command, then the ADE driving integration.

## What exists and what this adds

The owner's rule for the ADE is to build on the core's mechanisms and to give a reason for each new one ([rule](../../../instructions/generated/rule_5793ebf6ffa6982e41f8f85b.md)).

| Need                   | What exists                                                                                                                                                                                                    | What S2h adds, and why                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path exclusion         | `repositoryPathScopesOverlap`: exact and ancestor paths overlap, and `.` and `*` overlap every path (ADR-0205).                                                                                                | Nothing. Claims use the same policy.                                                                                                                       |
| Holding paths          | An assignment's `expectedPaths`, at most 128, under one lease with a generation. Creation requires at least one path, and no transition adds a path to a live lease: amendment only narrows an unstarted one.  | A conversation assignment that starts with no paths, and a transition that widens its live lease, because a conversation does not know its paths up front. |
| A check before a write | Managed runs authorize writes through `ProviderManagedWriteBridge`, a `PreToolUse` hook of the Claude Agent SDK. A hosted session's terminal hooks answer only `SessionStart`, `UserPromptSubmit`, and `Stop`. | A claim handler in the hosted session's settings, because hosted sessions run the provider CLI, not the SDK.                                               |
| A workspace generation | `lervo workspace start` provisions the worktree through ADR-0222's Git host adapter and writes its ownership marker as generation 1, but records no workspace, assignment, or lease.                           | The workspace record at the start, bound to the conversation's assignment.                                                                                 |
| Changes outside scope  | A worker's `Stop` partitions changed paths and blocks on any outside its assignment.                                                                                                                           | A conversation's `Stop` claims those paths and blocks only on a conflict.                                                                                  |
| Sealing, integration   | `planWorkspaceSeal`, `applyWorkspaceSeal`, and the integration plan, apply, verification, and completion in `@lervo/orchestrator`. Knowledge convergence is their only production caller.                      | `lervo workspace seal` and `lervo integration`, which the [agent workspace specification](../agent-workspaces.md) plans.                                   |
| Publication            | Knowledge publication's forge port and its GitHub CLI adapter keep one pull request for a Lervo branch.                                                                                                        | The same port for the batch's pull request.                                                                                                                |
| Room lines             | `lervo_notice` items: a code with parameters, rendered from the ADE's catalog.                                                                                                                                 | New codes.                                                                                                                                                 |

## Terms

- **Lead**: the conversation's first participant, whose session writes in its worktree ([Lervo ADE rooms](ade-rooms.md)).
- **Conversation assignment**: an ADR-0205 assignment with task type `repository.conversation`. It holds the lead's lease for one workspace generation.
- **Claim**: adding a path to the conversation assignment's lease before the lead's session writes it.
- **Holder**: the agent whose live lease, or whose sealed change awaiting integration, covers a path.
- **Batch**: the integrated changes on one branch, `lervo/batch/<6 hex>`, that one pull request carries to people.

## The conversation's assignment and workspace

`lervo workspace start` with a lead (S2c) gains a coordination stage after its workstream stage. When the registered repository's writer selects the coordination schema (schema 15, under "State, events, privacy, and failure meaning"), the stage:

1. Creates the conversation assignment: the lead's role, version, and contract hash, `accessMode: write`, no expected paths, the workspace's workstream, priority 50, the acceptance criterion "The conversation's sealed change passes its verification.", and the suite that `resolveAutomaticVerificationSuite` selects, or none when the project configures none.
2. Claims it for the lead with the lead session's writer session ID (`ses_terminal_` and 24 hex from the provider session) and a 10-minute lease.
3. Records workspace generation 1 under the hosted workspace's own ID (`wsp_`), bound to the marker the start wrote, in state `ready`. Its base is the branch head after the replay, so carried knowledge commits are not part of the conversation's change. Its integration target is the default branch, which the batch's pull request merges into.

The events are the existing `assignment.created`, `assignment.claimed`, and `agent.workspace.provisioned`. The start result gains `coordination`: `active`, `inactive` below the schema, or `unavailable` with a code when a step failed. In the last two cases the conversation writes without claims, as it does today, and `unavailable` shows one line. `lervo workspace open` runs the same stage for a conversation without an assignment, such as one started before S2h, and then claims every path the worktree changed since its base.

The workforce gains two exceptions, both limited to `repository.conversation`: creation accepts an empty path set, and an empty suite list when the project configures no suite. A lease with no paths overlaps nothing.

ADR-0637 left three settlements to the S2c specification, and [Lervo ADE agents](ade-agents.md) has not made them. S2h needs them, so this specification makes them for conversation workspaces:

- The session keeps ADR-0633's two roots. Today `resolveTerminalRoots` gives a live workforce workspace a single root, which would send a conversation's evidence back to the worktree's own store.
- Owner-instruction capture stays on. Today any workspace binding turns it off.
- `Stop` keeps the checks a linked worktree's `Stop` runs today. It then reconciles claims and pauses the workspace, as a worker's `Stop` does.

## Leases that grow with the work

A conversation's lease starts empty and grows by one claim at a time, so it holds the paths the conversation has written and nothing it has not.

### What a claim names

- A repository-relative path, normalized as the workforce's path policy requires: no leading `/`, no `.` or `..` segment, no backslash or NUL. The handler resolves the tool's path against the session's working directory and the worktree's root.
- A file tool claims the file. A shell operation on a directory, such as a recursive remove, claims the directory, which covers every path below it. A glob operand claims the deepest directory before its first wildcard, such as `src/net` for `src/net/*.ts`.
- These claim nothing: paths outside the worktree, paths Git ignores (one `git check-ignore` per request), and Lervo's runtime paths `.lervo/state`, `.lervo/data`, and `.lervo/run`, which no sealed change may contain.
- Where Git's `core.ignorecase` is true, a path that matches a tracked file ignoring case is claimed with the tracked spelling.
- A claim never names `.` or `*`, which would block every other agent.

### When the lead claims

For Claude Code, the hosted launch adds one `PreToolUse` handler to the session-scoped settings file, with the matcher `Edit|Write|MultiEdit|NotebookEdit|Bash` and a 10-second timeout. It runs the same terminal hook command as Lervo's other hooks, so a claim travels from the host launcher to the resident's context server, or through the CLI when that server is unavailable. A read-access launch gets no handler. The project's committed hooks do not gain it, because a terminal session outside the ADE holds no assignment, and ADR-0222 keeps unattached terminals repository-wide. S2e's `terminal.tool.observed` also needs a `PreToolUse` handler and shares this one.

| Tool                         | Paths claimed                                |
| ---------------------------- | -------------------------------------------- |
| `Edit`, `Write`, `MultiEdit` | `file_path`                                  |
| `NotebookEdit`               | `notebook_path`                              |
| `Bash`                       | The targets command detection finds, or none |

The handler reads only those fields, never `content`, `old_string`, `new_string`, or `edits`. Command detection splits the command at `;`, `&&`, `||`, `|`, and line ends, follows a leading `cd <dir>`, and recognizes these forms:

| Form                                                          | Claims                                         |
| ------------------------------------------------------------- | ---------------------------------------------- |
| Redirection `>`, `>>`, `&>`, or `2>` to a path outside `/dev` | The file                                       |
| `tee [-a] <files>`                                            | Each file                                      |
| `touch`, `mkdir`, `rm`, `rmdir`                               | Each operand; a directory claims the directory |
| `mv <sources> <target>`                                       | Each source and the target                     |
| `cp <sources> <target>`                                       | The target                                     |
| `sed -i`, `perl -i`                                           | Each file operand                              |
| `git mv`, `git rm`                                            | Each operand                                   |

An operand that contains `$` or a backquote is undetected. `git checkout ... -- <paths>` and `git restore` claim nothing: they return paths toward committed bytes, and reconciliation judges the result. Every other write, such as a formatter, a generator, a package manager, `git apply`, or a branch switch, is undetected, and the turn's end claims what it changed.

A request whose paths all sit inside the lease answers `allow` after reading the conversation's own assignment, without the scheduler lock. A `Bash` request with no detected target answers `allow` without reading state.

### How a claim widens the lease

A claim of a new path takes the workforce's scheduler lock, ADR-0205's short critical section, and:

1. Rereads the conversation assignment and checks that its lease is current and the lead's, that the lead is active, and that the lead's responsibility paths cover the path.
2. Checks for a conflict, as the next section defines.
3. Adds the paths, coalescing when needed, extends the lease to 10 minutes from now, and advances the assignment's revision. The lease generation stays, so the workspace generation's binding stays current.
4. Records `assignment.lease.renewed` with the grown path set. A failed event restores the assignment's bytes, as every workforce transition does, and the request answers `defer`.

The targets of one request are claimed in one transition, all or none.

Coalescing keeps a lease within the existing bound of 128 paths. The candidates are the directories, below the root, that hold a new path or an entry. Lervo takes the deepest candidate that covers at least two entries and overlaps no other holder's claim, breaking ties by path order, replaces the entries below it, and repeats until the set holds 128 or fewer. When no candidate fits, the claim is refused with `lease_path_limit`.

## Conflicts at claim time

A claim conflicts when, at that moment:

- another assignment's live write lease overlaps the path, under ADR-0205's rule and regardless of role (`path_leased`). Lervo's own agents count: a knowledge convergence writer's lease on a document stops a conversation's write to it, and the reverse holds too;
- another workspace's sealed generation changed the path and has not integrated: its state is `sealed`, `integration_pending`, `integrating`, or `integration_conflict` (`path_awaiting_integration`). The conversation's own earlier generations never count, because its next generation starts from their head.

A claim is also refused when the path is outside the lead's responsibility paths (`outside_responsibility`) or the lease cannot coalesce (`lease_path_limit`). Read-only leases never conflict, as today.

Knowledge convergence today holds a stage refused with `assignment_path_conflict` while any live write lease exists, overlapping or not. Conversation leases live for hours, so slice 1 narrows that hold to a lease that overlaps the stage's paths.

### The claim contract

The core takes a write intent and answers a claim decision. Both belong to the provider-neutral terminal hook contract:

- **Write intent**: `providerSessionId`, `toolUseId`, `toolClass` (`file`, `notebook`, or `shell`), `targets` (absolute paths, each `file` or `directory`), and `detection` (`exact`, `parsed`, or `undetected`).
- **Claim decision**: `allow`; `deny` with `code`, `paths` (repository-relative), `holder`, and `message`; or `defer` with `code`. `holder` is `{agentId, displayName, roleName, origin, workspaceId, conversationTitle, kind, until}` or null, where `kind` is `lease` or `sealed_change` and `until` is the lease's expiry or null.

An adapter declares `writeClaims` when its provider can stop a tool before it runs. The launch intent's hooks gain `claims`, the command, which the launch-intent check accepts only for a write-access launch of such an adapter. An adapter without `writeClaims` writes no handler, and its conversations claim only at the turn's end.

The Claude Code adapter maps the decision this way:

- `deny`: the handler prints `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": <message>}}` and exits 0. Claude Code skips the tool and gives the reason to the model.
- `allow` and `defer`: the handler prints nothing and exits 0. It never answers `"allow"`, which would skip the permission settings of a CLI conversation, where the owner answers prompts.
- A native hosted session runs in `bypassPermissions`. Before slice 1 ships, a canary shows that a denied `Edit` and a denied `Bash` leave the file's bytes unchanged in that mode.

### The message

The message is one paragraph: what stopped, the path, the holder and where it works, until when, why, and what to do. For `path_leased`:

> Lervo stopped this write. `src/retry.ts` is claimed by Arin (Developer) in the conversation "Log format" until 14:32. Two agents changing one path in parallel conflict when their work integrates. Do not write this path another way. Mention @Arin with the change you need, continue with other paths, or try again after Arin's change is sealed.

When Lervo's own agent holds the path, the message names "Lervo's knowledge maintenance" and offers only other paths or the time, because Lervo's agents are never mentioned. For `path_awaiting_integration`, it names the sealed change's conversation and says to try again once the change integrates and the branch includes it. For `outside_responsibility`, it says to mention an agent whose responsibility covers the path. For `lease_path_limit`, it says to seal the committed part of the change first. Times are the host's local `HH:MM`.

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

## Reconciling at the turn's end

The conversation's `Stop` lists the paths changed since the generation's base: committed, staged, unstaged, and untracked paths that Git does not ignore. It claims every changed path outside the lease in one transition, as a hook claim would.

- A conflict blocks `Stop` once, with a message naming each path, its holder, and how to return the path to its base bytes, such as `git restore --source=<base> --staged --worktree -- src/retry.ts`.
- When `Stop` runs again with `stop_hook_active` and a conflict remains, it lets the turn end and records the path as `unresolved`. The conversation shows "`src/retry.ts` changed without a claim · Arin holds it" with the amber sign.
- Sealing refuses while a path stays unresolved (`seal_paths_conflict`). A later turn that returns the path to its base resolves it.

## Lease lifetime

- **Duration.** A conversation lease runs 10 minutes from its last claim or renewal, inside the existing bounds of 5 seconds to 30 minutes.
- **Renewal while the session works.** The resident renews each conversation lease every 4 minutes while it holds a decoder for the lead's session, has no `session.exited` report for it, and the lead is active. Each prompt, claim, and `Stop` of the lead's session also renews when less than 5 minutes remain, so hooks that run without the resident keep the lease. A renewal is the existing `assignment.lease.renewed` without path fields.
- **Release when sealed.** Sealing completes the assignment (`assignment.completed`), which ends its lease. Until the sealed change integrates, its paths conflict through `path_awaiting_integration`, so the release opens no window for a parallel change.
- **Release when retired.** Retiring cancels the conversation assignment (`assignment.cancelled`, reason `requested`). Cancellation refuses a live lease today (`active_lease`), so the retire passes the holder's exact agent and lease, a holder-bound form of cancellation. Retire refuses with `workspace_integration_pending` while a sealed generation of the conversation waits for integration.
- **Expiry when the session dies.** A session that exits or crashes stops renewing, and its lease expires at most 10 minutes later. Lervo does not release it at the exit, so a session resumed within that time keeps its claims. Expiry changes no workspace state (ADR-0222).
- **Coming back after expiry.** The lead session's next prompt or claim reacquires the assignment under the scheduler lock with the next lease generation. Paths another holder claimed meanwhile leave the lease, and each one the worktree changed is reported at once, as reconciliation reports a conflict. The workspace then adopts the new lease generation on its next activation, with the reason `lease_regenerated`. Neither step exists today: `claimAssignment` fails the whole claim when one path overlaps, and a workspace record cannot change its lease generation.
- **Across hosts.** A lease coordinates one repository instance through its Git common directory. Clones on two hosts do not see each other's leases until Hub-coordinated mode extends its reservations to growing leases.

## Sealing

For an ADE conversation, a sealed change is its committed work as one immutable ADR-0222 generation: a clean worktree, the base and head commits, the tree, the changed paths, all inside the lease and none unresolved, a passed result for each suite the assignment names, and a result artifact. Lervo never commits; the lead or the owner does.

1. The lead runs `lervo workspace seal --write` when the owner says the work is done, or when it has finished and committed a coherent change. The command reconciles claims, checks that the checkout is clean and nothing is unresolved, records a seal request for the current head, and returns at once. A refusal names its code.
2. Verification runs in an isolated worktree of the requested head, prepared as [ADR-0625](../../../decisions/execution/verification/0625-prepare-isolated-candidate-verification-workspaces.md) prepares one, so it never waits inside a turn or a tool's timeout.
3. Once verification passes and the turn has ended, the resident applies the seal from `paused`. The state machine already allows `paused -> sealing`; `planWorkspaceSeal` accepts only `active` today and gains `paused`. The seal completes the assignment with the result artifact and queues the generation (`integration_pending`).
4. A write that moves the head before the seal applies drops the request (`seal_superseded`). A failed suite drops it too (`seal_verification_failed`), and the next prompt's Lervo context names the suite and its result artifact.
5. After the seal, the conversation continues in the same worktree as the next generation: a new conversation assignment with no paths, claimed by the lead, and a generation record based on the sealed head. The Git adapter creates its marker exclusively today, so the next generation replaces it by compare-and-swap. A generation that a later one superseded in its checkout never becomes cleanup-eligible.

A prompt that arrives while a seal applies waits up to 5 seconds for it. Past that, its turn's claims defer to its end.

## Integration in small steps

- **Target.** Each project integrates into a batch branch, `lervo/batch/<6 hex>`, created from the default branch's upstream tip by the rule `lervo workspace start` uses for a base. No worktree checks it out, because target advancement refuses a checked-out ref. A batch stays open until its pull request merges; the next integration then starts a new batch.
- **Integrator.** Lervo's own agent integrates, with `origin: lervo`, so the sidebar does not show it ([ADR-0643](../../../decisions/execution/orchestration/0643-record-which-agents-are-lervos-own.md)). Its `repository.integration` assignment covers the selected sources' changed paths, and its integration worktree sits under the workspaces home, apart from every conversation. The resident runs it; no provider session takes part, and Git operations stay the exact ones ADR-0222 allows.
- **The command.** `lervo integration queue` lists queued generations. `lervo integration plan` builds a read-only plan of at most 32 sources for the open batch. `lervo integration apply --plan <id> --write` prepares the candidate, verifies it with the project's suite, advances the batch branch by compare-and-swap, and records `assignment.integration.recorded`. `lervo integration resolve` releases an attempt or requeues a reworked source. Each calls the existing orchestrator functions.
- **Cadence.** When a generation is queued and no attempt is open, the resident waits 2 minutes for more seals to join, then integrates. A project without a suite does not integrate (`verification_unconfigured`); its sealed changes wait, and the sidebar's batch row says so.
- **Conflict.** A conflict records `integration_conflict` and keeps the sealed generation, as ADR-0222 defines. The conversation shows "Integration conflict with Fix retry budget" with the amber sign. The lead's next prompt's Lervo context names the other conversation and the batch branch, so the lead can update its branch from the batch and seal again. Until then the generation's paths keep conflicting.
- **Publication.** After an integration, Lervo pushes the batch branch and opens or updates one pull request from it to the default branch, through knowledge publication's forge port. The body lists each integrated conversation's title, lead, sealed head, and verification result. Pushes happen at most once every 10 minutes while integrations continue, which bounds the repository's CI runs for a batch. Lervo never merges the pull request and never force-pushes: a push that is not a fast-forward stops with `publication_diverged`. Missing credentials or a missing remote are notice-only (`publication_credentials_missing`): integration goes on locally, and the pull request waits.

## What the ADE shows

The [craft rules](ade-craft.md) apply: finished work shows nothing, and only what needs the person adds a sign.

- **In the conversation.** The turn summary counts the turn's new claims, "Claimed 3 paths". Quiet room lines without a mark show refusals, unresolved and deferred claims, "Claims widened to `src/net/`", "Sealed · 4 files", "Seal verification failed (repository.default.v9)", "Integrated into pull request #812", and integration conflicts. Paths show whole and relative to the repository, never cut off (rule 8).
- **The amber sign.** An unresolved path or an integration conflict adds the still amber dot beside the conversation (rule 21) until it resolves. Nothing else adds a sign.
- **The sidebar.** While a batch pull request is open, one quiet row below the conversations names it, "Pull request #812 · 3 conversations", and opens it in the browser.

## Read-access participants

- A joined agent's session runs with read access ([Lervo ADE rooms](ade-rooms.md)). It claims nothing and holds no assignment or lease: its launch has no claim handler, and its tool allowlist already refuses writes. A read-only lease would grant nothing and block nothing.
- A joined agent that needs to write does not become a second writer; ADR-0222 keeps one writer per generation. It mentions the lead with the change it needs. When the work is its own, it starts its own conversation, as rooms slice 2 defines (`workspace.start` with `startedBy`). That conversation gets its own workspace generation, assignment, and growing lease, and its claims conflict with the first conversation's like any other's.
- A test run writes build output that Git ignores, which claims nothing. Whether a read-access session may run tests is therefore a question of its tool allowlist alone, which settles S2h's part of the [rooms open item](ade-rooms.md#open-items).

## State, events, privacy, and failure meaning

- **State.**
  - The conversation assignment and the workspace records live in the coordination home under the Git common directory, as every assignment and workspace does. They hold repository-relative paths as owner-only state that nothing publishes.
  - The claim log is host-local operational state beside the hosted launch records, mode 0600, at most 512 entries per conversation with the oldest dropped. Each entry holds `claimId`, `sessionId`, `toolUseId` or null, the decision, the code, the repository-relative paths, the holder's agent and workspace IDs, the state (`refused`, `deferred`, `unresolved`, or `resolved`), and the times. It holds no tool input, command text, or file content.
  - The seal request sits beside the workspace record: the head commit, the request time, and the verification's artifact IDs.
- **Reused events.** `assignment.created`, `assignment.claimed`, `assignment.lease.renewed`, `assignment.completed`, and `assignment.cancelled` go to the registered repository's store, never the worktree's. `agent.workspace.provisioned`, `agent.workspace.state.changed`, `agent.workspace.checkpointed`, `agent.workspace.sealed`, `assignment.integration.state.changed`, `assignment.integration.recorded`, and `agent.workspace.removed` stay in the coordination home. Workspace state changes gain two reason codes: `lease_regenerated`, and `conversation_retired`, with which a retired conversation's record moves to `recovery_required` and then `removed`, as a never-used checkout's does.
- **The next event schema.** This specification names it schema 15:
  - `assignment.lease.renewed` may carry `expectedPathDigest` (the digest `assignment.claimed` uses, over the sorted path set), `expectedPathCount`, and `cause` (`claim` or `reconcile`). A renewal that adds no path omits them and stays readable at every schema.
  - `assignment.claim.refused` is new. Its required fields are `assignmentId`, `agentId`, `leaseGeneration`, `code`, `holderAgentId`, `holderAssignmentId`, `holderWorkspaceId` (each holder field null where none applies), `pathDigest`, `detection` (`tool`, `shell`, or `reconcile`), and `occurredAt`. `pathDigest` is the SHA-256 of `lervo.claim.path.v1`, the repository instance ID, and the path, joined by NUL. Lervo records at most one per session, holder, and path digest in a turn. It proves that Lervo refused the claim, not that the provider skipped the tool or that the agent stopped. A missing event never means that no conflict happened.
  - Payloads exclude paths, tool input, command text, file content, conversation titles, the message, provider session IDs, and tool use IDs.
- **Coordinating the version.** [Lervo ADE rooms](ade-rooms.md) defines `room.*` events that hold no version yet, and both sets need the next one after 14. If the rooms events take 15 first, these take the following version, and both may share one when they ship together. Readers ship first; `lervo upgrade` activates the version only after every configured reader, the Hub included, reports it ([event envelope compatibility](../events-and-privacy/event-envelope-compatibility.md)). A workforce transition without its event does not commit (ADR-0205), so a lease cannot grow below that version: the coordination stage does not run, and conversations write without claims.

| Code                              | Meaning                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `path_leased`                     | Another assignment's live write lease overlaps the path. The write stopped.                                |
| `path_awaiting_integration`       | Another conversation's sealed change touched the path and has not integrated. The write stopped.           |
| `outside_responsibility`          | The path is outside the lead's responsibility paths. The write stopped.                                    |
| `lease_path_limit`                | The lease holds 128 entries and cannot coalesce without overlapping another claim. The write stopped.      |
| `claim_deferred`                  | Lervo could not decide within 2 seconds or failed. The write went ahead, and the turn's end claims it.     |
| `claim_unresolved`                | A changed path still conflicted after `Stop`'s second run. Sealing refuses until it returns to its base.   |
| `coordination_inactive`           | The writer selects a schema below the coordination schema. The conversation writes without claims.         |
| `coordination_unavailable`        | The start could not create the assignment or the workspace record. The conversation writes without claims. |
| `seal_checkout_not_clean`         | The worktree holds uncommitted changes or untracked files. Nothing was sealed.                             |
| `seal_paths_conflict`             | A changed path is unresolved. Nothing was sealed.                                                          |
| `seal_verification_failed`        | A suite failed on the requested head. Nothing was sealed, and the lease holds.                             |
| `seal_superseded`                 | The head moved before the seal applied. Nothing was sealed.                                                |
| `workspace_integration_pending`   | Retire refused while a sealed generation waits for integration. Nothing changed.                           |
| `verification_unconfigured`       | The project configures no suite. Sealed changes wait for integration.                                      |
| `publication_diverged`            | The remote batch branch moved. Lervo pushed nothing and never force-pushes.                                |
| `publication_credentials_missing` | No remote or no signed-in forge client. Integration goes on locally; the pull request waits.               |

## Verification

Each check reads the core's records, not only what the conversation shows.

- **Slice 0.** A reader at schema 14 refuses `assignment.claim.refused` and the renewal's path fields; one at 15 accepts them. `lervo upgrade` does not activate 15 while the Hub reports 14.
- **Slice 1, units.** Path normalization, ignored paths, and case folding; each detected and each undetected command form; coalescing on a fixed set; a widening whose event fails restores the assignment's bytes; a claim inside the lease takes no lock.
- **Slice 1, two conversations in two worktrees of one registered repository.**
  - A's `Edit` of `src/a.ts` records `assignment.lease.renewed` with `expectedPathCount: 1` in the repository's store.
  - B's `Edit` of `src/a.ts` is denied, and the file keeps its bytes. The reason names A's lead and conversation, `assignment.claim.refused` names A's assignment, and B's timeline shows `claim_conflict`. B's `Write` of `src/b.ts` succeeds.
  - B's `printf x > src/a.ts` is denied the same way. B's `node -e` write to `src/a.ts` runs, and B's `Stop` blocks once, naming `src/a.ts` and A's lead.
  - With a fake clock, A's lease renews while its process runs and expires 10 minutes after the process exits. B's claim then succeeds. A's resumed session reports `src/a.ts` as a conflict and activates with `lease_regenerated`.
  - Both conversations keep recording owner-rule captures and `terminal.turn.observed` in the repository, not in a worktree.
  - A knowledge convergence stage held by `assignment_path_conflict` resumes while an unrelated conversation lease stays live.
- **Slice 1, canary.** In a native hosted session, a denied `Edit` and a denied `Bash` leave the file unchanged.
- **Slice 2.** Seal refuses a dirty or unresolved worktree. A passed seal records `agent.workspace.sealed` and `assignment.completed`. B's claim of a path that A's sealed change touched is refused with `path_awaiting_integration` until that change integrates. The next generation starts with no paths. Retire refuses while the seal waits and otherwise records `assignment.cancelled`.
- **Slice 3.** Two sealed conversations integrate into one batch with one `assignment.integration.recorded` and one compare-and-swap advance. A fake forge sees one pull request updated, never two. A text conflict records `integration_conflict`, and the source stays sealed. No push forces.
- **Slice 4.** Each line, the amber sign, and the sidebar row are checked in the real app, in light and dark ([craft rules](ade-craft.md), rule 17).

## Open items

- Hub-coordinated growing leases: widening a Hub reservation as the local lease grows, so clones on two hosts coordinate through the Hub instead of each instance alone.
- A claim on a path that an integrated change touched after the workspace's base is allowed. Whether a claim should first require the branch to include the batch is open.
- ADR-0632's S2c check says each session holds its own lease. This specification gives a read-access participant none, because a read-only lease grants and blocks nothing. Whether that check should name only the writer's lease is open.
- A write into another checkout of the same repository, such as the main checkout through an absolute path, claims nothing. Whether Lervo should stop it is open.
- The same suite runs at the seal and at integration. Whether the seal can run a lighter one is open.
- What happens to a batch's conversations when people close its pull request without merging.
- A provider whose sessions cannot resume would leave a dead writer in an `active` workspace. Such an adapter needs a recorded pause at the exit before it declares `writeClaims`.
