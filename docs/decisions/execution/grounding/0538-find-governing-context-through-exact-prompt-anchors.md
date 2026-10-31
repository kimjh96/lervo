# ADR-0538: Find governing context through exact prompt anchors

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) (prompt-time hits)

## Context

[ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) decided that the prompt hook attaches up to three document pointers from a prepared lexical index within 150 ms, without a provider call. On 2026-10-31 that was not implemented:

- In `lervo`, the last `context.injected` event was on 2026-09-08, and there were no `context.referenced` events in seven days.
- The compact prompt names nothing the owner points at. When a prompt names `apps/web`, nothing tells Claude Code that `apps/web/AGENTS.md` governs it, and a `/skill` or `ADR-####` named in the prompt gets no path or hash.

A lexical pointer search on the raw prompt has a deeper problem. The owner writes prompts in Korean, and canonical documents are English. Lexical matching across languages misses, and translating with a provider call per prompt took 6 to 9 seconds before ADR-0451 removed it. The owner has also prohibited keyword or title-term rules for semantic decisions ([ADR-0476](../../knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)).

## Decision

Prompt-time Find uses **exact anchors**, which are references that identify a target without interpreting meaning. Semantic search stays with the agent.

### Exact anchors

The hook extracts anchors from the prompt deterministically, with no provider call, within a fixed budget:

- **Paths.** A path anchor is written as a path. A token with a slash anchors when it equals a snapshot path or a directory that prefixes snapshot files. A token without a slash anchors only when it is a file name with an extension that equals a root file or names exactly one snapshot file. A bare word such as `docs` or `src` names nothing, even when a directory has that name.
- **Spellings.** The exact token is tried first. Only when it names nothing are fixed character rules tried: a leading `./`, enclosing brackets or trailing punctuation, a `:line` suffix, and then an attached Korean particle of at most three syllables. Brackets and parentheses inside a path, as in `app/[lang]/page.tsx`, stay part of it, and a backtick span keeps a path with spaces whole.
- **Skills.** An explicit invocation names the installed skill with that identifier under `.agents/skills`: `/name` as Claude Code writes it, or `$name` as Codex writes it. A bare word that equals a skill identifier, such as a repository name, names nothing.
- **Decisions.** `ADR-0123` or `ADR 0123` names the decision file with that number.

Anchors are bounded, at most 16 paths, and extraction is linear in the snapshot and the bounded prompt. Unmatched tokens are ignored, never guessed.

### What anchors select

- Path anchors never narrow owner-rule selection. A prompt names some of the paths a turn may change, not all of them, so treating anchors as the full target set would exclude path-scoped rules that still apply. Owner-rule selection keeps its unresolved scope.
- For each path anchor, the nearest nested `AGENTS.md` at or above it, excluding the root file, becomes a pointer. Codex reads nested instruction files in its working directory, but Claude Code does not read them on its own. The pointer tells either provider which file governs the named path.
- Skill, decision, and instruction anchors add at most three pointer lines with path and content hash, for example: `Lervo find: skill eli5 (.agents/skills/eli5/SKILL.md, sha256:…), named in the prompt.` The hook delivers the pointer only, never the body.
- Owner rules are packed first. A pointer line is added whole, and only while the compact context budget allows, so pointers never displace a rule.
- Pointers that reach the context are recorded as `selected` in the existing preparation observation, with path-derived source identifiers and content hashes, and with loading unobserved. Pointers are not claimed as loaded, injected, or used.

### Semantic search stays with the agent

Meaning-based search runs when the agent calls `lervo knowledge query` with its own English query, as AGENTS.md requires. Binding those queries to the current turn and observing references at `Stop` are follow-up slices under ADR-0459.

## State, events, privacy, and failure meaning

- No event type is added. Pointer selections reuse the existing preparation observation fields. This feature stores no prompt text.
- Extraction cannot fail on input size: the prompt is read up to a fixed length and indexes are built in one pass. A malformed snapshot yields no anchors.

## Verification

Focused tests must show:

- An exact path, a unique file name, a `/skill` or `$skill` token, and an `ADR-####` token each produce the right anchor. Ambiguous file names, bare directory names, bare skill identifiers, and free words produce none.
- Paths with brackets, parentheses, line suffixes, and attached particles resolve to one exact path, and the exact spelling wins over a stripped one.
- The nearest nested `AGENTS.md` of a named path becomes a pointer, and anchors do not change owner-rule selection.
- Skill and decision pointers carry path and hash, are capped at three, never include file bodies, and never displace an owner rule.
- No provider call is made, and extraction stays linear when many files share a basename.

Installed verification must show `/eli5 …` in `axli` naming the `eli5` skill pointer, and a prompt naming `apps/web` in `flemo` pointing at `apps/web/AGENTS.md`.
