# Native terminal skill observation

[ADR-0542](../../../decisions/execution/grounding/0542-observe-native-skill-use-instead-of-repeating-skill-disclosure.md) defines this contract. Providers disclose installed skills. Compact context adds no installed-skill list. Explicit `/name` and `$name` anchors retain the ADR-0538 pointer behavior.

## Hook ingress

`transcript_path` is optional on both hook events. Invalid optional values provide no transcript coordinate. Prompt submission captures only the regular file's path, byte size, device, and inode. The open-turn marker retains this position with the existing context event and provider digests. Historical markers without it remain readable. Markers are bounded at 8 KiB and expire after six hours.

Stop captures the final position and commits `terminal.turn.observed` before enqueueing the range. The queue binds the prepared context event ID and closing turn event ID. These distinguish Claude turns whose provider turn digest is null. Hooks neither open nor parse the transcript. Queue failures never block Stop.

The host-private queue lives at `.lervo/state/knowledge/terminal-skills/queue/`. Files use mode 0600 in directories created with mode 0700. Producers refuse symbolic links in state directories. Records contain only provider coordinates, event IDs, transcript positions, and enqueue time. They expire after 24 hours. The next enqueue or resident cycle removes expired records. At most 128 records remain; overflow evicts the oldest unassessed range. Lost observations never become evidence of zero use.

The generated hook contains no resident parser. Installation remembers the full CLI entry in `.lervo/state/terminal-integration/worker-entry.json`, a private 0600 file. Stop can launch a detached full-CLI cycle through that entry. A missing entry or failed launch leaves the queue for the resident. No PATH-resolved CLI runs on the hook path.

## Resident assessment

Every host drains its own queue under the knowledge worker lock before provider assessment, freshness preparation, or convergence ownership checks. This observation needs no provider call, Hub, or convergence write authority. A cycle processes at most four ranges. Queue-directory changes wake the resident. The daily date also invalidates its idle fence.

The resident verifies the closing event, context event, provider, and digests before reading a range. It checks file identity and size again through the open file handle. It reads only `[startOffset, stopOffset)`, up to 4 MiB. Later appends and earlier turns are excluded. Malformed JSONL, missing coordinates, unreadable files, replacement files, and shrunken files produce `unavailable`. A larger range produces `truncated` with no partial invocation count. A complete readable range produces `observed`, including zero invocations.

Claude records qualify only through assistant `message.content` entries with `type: tool_use`, `name: Skill`, and `input.skill`. The Codex adapter accepts an explicit `response_item` function call named `Skill` with JSON arguments containing `skill`. It never infers invocation from shell commands, file reads, text mentions, or tool output. Installed Codex support remains unverified; an absent transcript path is unavailable.

Repository membership comes from `.agents/skills/<name>/SKILL.md`. A provider skill link may supply an alias only when its resolved file is one of those repository files. A path outside the repository cannot establish membership. Catalogs are bounded at 1,024 entries and skill files at 256 KiB. An incomplete catalog makes the assessment unavailable. External plugin, user, and built-in invocations contribute only a total count.

Each repository invocation produces `terminal.skill.observed`. A delivered explicit skill pointer produces the same event with `source: prompt_invocation`, independently of transcript availability. Transcript invocations use `source: provider_transcript`. Required fields are `skillId`, repository-relative `path`, `contentHash`, `provider`, source, both provider digests, and `observedAt`. They prove invocation evidence, never instruction compliance or managed `skill.invoked` delivery.

The resident records `terminal.skill.turn_assessed` after the closing turn. Required fields are both provider digests, `skillTelemetry`, `externalSkillCount`, and `observedAt`. Invocations and the assessment commit together. Identities bind the context event and invocation ordinal, so replay cannot duplicate them. Assessment time uses the closing turn's time; the event envelope records when the resident wrote it. Events contain no transcript path, external skill identifier, prompt, reply, or tool content.

## Daily usage and retirement review

One current projection at `.lervo/state/knowledge/terminal-skills/usage.json` counts each installed skill's invocation evidence in the trailing 30 days. `lervo terminal status --json` exposes it as `skillUsage`. Human status reports the observed turn count and number of retirement candidates.

A skill with no invocation in the window becomes a retirement candidate after 20 fully observed assessments. Unavailable and truncated turns do not satisfy that threshold. The projection retains current skill coordinates, counts, and at most 20 supporting event IDs per evidence set. Its reviewer is `principal_proxy`; it creates no owner decision or approval. Removal still requires the normal repository publication path. The current source has no autonomous principal-proxy review loop. This implementation exposes review candidates without claiming that review or removal occurred.

Deleting the projection loses no canonical evidence. The next daily cycle rebuilds it from events and installed skill files. No transcript bytes are retained or sent to a provider.

## Verification boundary

Focused tests cover metadata-only hooks, event ordering and replay, provider aliases, external counts, earlier and later turn exclusion, the 4 MiB bound, missing or replaced files, optional Codex paths, event redaction, queue retention, and the 30-day retirement threshold. These tests are written without execution for this task.

Installed acceptance remains open. In `axli`, capture a Claude Code turn that invokes `eli5`. Retain the installed build, prepared context event ID, closing event ID, one `terminal.skill.observed` event with its path and hash, and the assessment event. The optional installed regression reads those exact coordinates when explicitly configured. Do not retain transcript content in repository evidence.
