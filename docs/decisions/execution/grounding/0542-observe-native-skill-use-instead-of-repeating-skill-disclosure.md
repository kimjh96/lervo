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

### `Stop` observes skill invocations from the provider transcript

When the `Stop` hook input names a transcript path, the hook reads the closing turn from that transcript:

- It reads only the turn's entries, from the newest user prompt to the end, and at most the last 4 MiB of the file.
- It extracts skill invocations: Claude Code `tool_use` entries named `Skill`, with the skill identifier in `input.skill`, and the equivalent Codex entries when its transcript records them.
- An invocation counts only when its identifier names a skill installed in the repository: `.agents/skills/<name>/SKILL.md`, or a provider surface that links to it. Plugin, user, and built-in skills are outside the repository and are counted only as one total.

Each counted invocation records one `terminal.skill.observed` event with the skill identifier, `SKILL.md` path, content hash, provider, turn coordinates, and `source: "provider_transcript"`. A `/name` or `$name` prompt anchor records the same event with `source: "prompt_invocation"`.

A transcript entry proves that the provider invoked the skill. It does not prove that the skill's instructions were followed. These events are distinct from `skill.invoked`, which [ADR-0452](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md) evidence reserves for managed runs that deliver the skill body.

### Use decides whether a skill earns its place

A daily projection counts observed invocations per installed skill over 30 days. A skill with no observed invocation in 30 days, after at least 20 observed terminal turns in its repository, becomes a retirement candidate. The principal proxy reviews it with the usage evidence; the owner is not asked. Removing a skill remains a repository write through the normal publication path.

## Events, states, privacy, and failure meaning

- `terminal.skill.observed` (new): required `skillId`, `path`, `contentHash`, `provider`, `source` (`provider_transcript | prompt_invocation`), `providerSessionDigest`, `providerTurnDigest`, `observedAt`.
- `terminal.turn.observed` gains `skillTelemetry` (`observed | unavailable | truncated`) and `externalSkillCount`.
- The transcript is read locally and never stored. Events carry skill identifiers, repository paths, and hashes only, never prompt, reply, or tool content. External skill identifiers are not recorded, only their count.
- A missing, unreadable, or oversized transcript sets `skillTelemetry` to `unavailable` or `truncated`. It never fails the hook or blocks the turn.

## Verification

Focused tests must show:

- a Claude Code transcript turn with a `Skill` invocation of an installed repository skill records one event with path and hash;
- invocations of plugin or user skills record only `externalSkillCount`;
- entries from earlier turns are ignored, and the 4 MiB bound sets `truncated`;
- a missing transcript records `unavailable` without failing `Stop`;
- the 30-day projection marks a skill with zero invocations after 20 turns as a retirement candidate for the principal proxy.

Installed verification must show, in `axli`, a Claude Code turn that invokes `eli5` recorded as one `terminal.skill.observed` event.
