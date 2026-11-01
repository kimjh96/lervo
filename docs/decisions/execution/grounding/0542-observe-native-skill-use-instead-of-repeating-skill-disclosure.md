# ADR-0542: Observe native skill use instead of repeating skill disclosure

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0458](../orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) (progressive disclosure in the compact prompt), [ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) (terminal usage measurement)

## Context

[ADR-0458](../orchestration/improvement/0458-learn-from-single-observations-and-run-standing-autonomy.md) moves capability recommendation into the compact terminal prompt, naming up to three candidates. The managed-run recommender it would reuse scores author-declared intents and keywords against the prompt. Owner prompts are usually Korean, and the owner prohibits keyword rules for meaning.

Both terminal providers already disclose installed skills themselves:

- Claude Code loads `.claude/skills`. In `axli`, `.claude/skills/eli5` is a link to the portable `.agents/skills/eli5`.
- Codex has its own `SKILL.md` loader.

Each provider puts the name and description in its own context, and the agent decides by meaning. Lervo repeating installed skill names would spend tokens for no new information.

What Lervo lacks is evidence of use. A skills audit on 2026-10-31 found zero `skill.*` events across six repositories. In `axli`, the 20 most recent Claude Code sessions invoked no `eli5`. Nothing told the owner or Lervo whether a skill earns its place.

## Decision

### Installed skills are disclosed by the provider

The compact prompt does not list installed skills. ADR-0458 disclosure in the compact prompt applies only to unreviewed candidates that no provider loads natively. An explicit `/name` or `$name` in the prompt still produces an [ADR-0538](0538-find-governing-context-through-exact-prompt-anchors.md) pointer.

### The resident observes skill invocations from the provider transcript

The hooks only record where the turn is. When the provider's hook input names a transcript path, `UserPromptSubmit` stores the transcript's byte size, inode, device, and SHA-256 of its first 4 KiB (or its complete prefix when shorter) in the ADR-0541 open-turn marker, and `Stop` queues the transcript path, that start offset, the size at `Stop`, the repository HEAD, and the turn coordinates in a host-private queue. Hooks read at most 4 KiB to hash the prefix. They never parse the transcript. This bounded authenticity check amends the earlier metadata-only hook claim.

The knowledge resident drains the queue:

- It reads only the turn's byte range, at most 4 MiB, and drops the turn as `truncated` beyond that.
- It accepts only regular files owned by the current user in `~/.claude/projects/` or the configured Codex home's `sessions/` directory. Resolved paths cannot escape those directories. The inode and the prompt-time prefix digest must still match.
- Every Claude JSONL line in the range must carry `sessionId`. Its provider-prefixed digest must equal the hook session digest. A missing or different identity makes the range `unavailable`.
- It extracts skill invocations: Claude Code `tool_use` entries named `Skill`, with the skill identifier in `input.skill`, and equivalent Codex entries only after an installed transcript fixture proves invocation telemetry. Until then, every Codex turn has `unknown` coverage.
- An invocation counts only when its identifier names a skill installed in the repository: `.agents/skills/<name>/SKILL.md`, or a provider surface that links to it. Plugin, user, and built-in skills are outside the repository and are counted only as one total.
- Membership and skill hashes come from bounded Git object reads at the Stop revision. A missing revision or a skill absent from that revision yields `unknown` attribution. Uncommitted skills never supply a current hash or establish external membership. Claude provider surfaces take precedence over portable names. A name collision on different targets is ambiguous and produces no attribution.
- A transcript that was rotated or shrank below the recorded range is `unavailable` for that turn.

After schema 7 writer activation proves support from every configured reader, each counted invocation records one `terminal.skill.observed` event with the skill identifier, `SKILL.md` path, content hash, provider, turn coordinates, and `source: "provider_transcript"`. A delivered `/name` or `$name` prompt pointer records the same event with `source: "prompt_invocation"` when its path and hash match that revision and provider resolution is unambiguous. Before activation, observations stay in the bounded host-private projection and never enter the canonical event log.

A transcript entry proves that the provider invoked the skill. It does not prove that the skill's instructions were followed. These events are distinct from `skill.invoked`, which [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md) evidence reserves for managed runs that deliver the skill body.

### The hook bundle starts the full CLI for background work

The terminal hook bundle no longer contains the knowledge worker. `lervo upgrade` and `lervo migrate knowledge` record the installed CLI entry's real path and SHA-256 in `.lervo/state/terminal-integration/worker-entry.json`. After `Stop`, the hook starts `knowledge worker --once` through that entry, detached. The real path must still name a regular file owned by the current user, with no group or other write permission, and its SHA-256 must still match. Every upgrade or migration refreshes this binding. A missing, unsafe, or changed entry starts nothing; the host resident's next cycle does the same work. This removed about 650 KB from the hook bundle, which had 2 KB left under its 8 MiB limit.

### Use decides whether a skill earns its place

A daily projection counts observed invocations per installed skill over 30 days. A skill with no observed invocation in 30 days, after at least 20 fully observed Claude terminal turns in its repository, becomes a retirement candidate. The principal proxy reviews it with the usage evidence; the owner is not asked. Removing a skill remains a repository write through the normal publication path.

## Events, states, privacy, and failure meaning

- `terminal.skill.observed` (new): required `skillId`, `path`, `contentHash`, `provider`, `source` (`provider_transcript | prompt_invocation`), `providerSessionDigest`, `providerTurnDigest`, `observedAt`.
- `terminal.skill.turn_assessed` (new): `providerSessionDigest`, `providerTurnDigest`, `provider`, `skillTelemetry` (`observed | unavailable | truncated | unknown`), `externalSkillCount`, `unknownSkillCount`, `ambiguousSkillCount`, `observedAt`. Unknown and ambiguous counts carry no identifiers and exclude the turn from retirement coverage. It is recorded by the resident, after `terminal.turn.observed`.
- The queue holds only transcript positions, prefix digests, the Stop revision, event IDs, and provider digests, in Git-ignored 0600 files, for at most 24 hours. The transcript is read locally by the resident and never stored or sent to a provider. Events carry skill identifiers, repository paths, and hashes only, never prompt, reply, or tool content. External skill identifiers are not recorded, only their count.
- Hooks perform one atomic enqueue without scanning or pruning. Only the resident expires records after 24 hours and bounds eligible records at 128, using the current cycle time. Records newer than that time are left for a later cycle.
- A missing, unreadable, or oversized transcript sets `skillTelemetry` to `unavailable` or `truncated`. It never fails the hook or blocks the turn.

## Verification

Focused tests must show:

- the hooks record only coordinates and a bounded prefix digest, and the resident records one event, with path and hash, for a Claude Code `Skill` invocation of an installed repository skill;
- invocations of plugin or user skills record only `externalSkillCount`;
- entries from earlier turns are ignored, and the 4 MiB bound sets `truncated`;
- a missing, rotated, or shrunken transcript records `unavailable` without failing `Stop` or the resident cycle;
- path forgery, symlink escape, foreign ownership, in-place prefix replacement, and foreign or missing session identities produce no invocation evidence;
- worker entry replacement, unsafe permissions, foreign ownership, and path-only legacy records start no worker;
- conflicting provider names remain ambiguous, and delayed reads retain the Stop revision's hash;
- older readers receive no new event types before schema 7 activation; Codex turns remain unknown;
- concurrent queue producers never prune or overwrite another turn, and resident cleanup preserves future records;
- the 30-day projection marks a skill with zero invocations after 20 turns as a retirement candidate for the principal proxy.

Installed verification must show, in `axli`, a Claude Code turn that invokes `eli5` recorded as one `terminal.skill.observed` event.

[ADR-0553](0553-bind-terminal-observations-to-the-provider-session-and-the-first-turn.md) starts the range of a first turn at the beginning of a transcript the provider created after the prompt.
