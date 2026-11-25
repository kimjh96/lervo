# ADR-0555: Keep operating signals visible and honest

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0535](0535-project-core-health-with-actor-owned-attention.md) (terminal display and refresh), [ADR-0462](0462-own-workstream-bookkeeping-and-stale-attention.md) (commit distance), [ADR-0553](../grounding/0553-bind-terminal-observations-to-the-provider-session-and-the-first-turn.md) (Codex query binding), [ADR-0532](../../knowledge/maintenance/0532-continue-background-review-past-capacity-and-optional-context-failures.md) (unclassified failure evidence)
Amended by: [ADR-0595](../../knowledge/maintenance/0595-back-off-held-and-failing-residents-and-refresh-health-only-on-change.md)

## Context

The 0.23.3 rollout on 2026-11-01 exposed several operating signals that hid information or reported noise.

- **Health disappeared during development.** A terminal turn showed health only when the projection's repository revision equaled the current working-tree snapshot. Any edit, including the owner's, replaced every measure with `unknown`. The resident refreshed the projection only after a cycle, and a cycle can run longer than the 20-minute display window. Turns in this repository showed `Lervo health: unknown: convergence, longestStop, freshness, ownerReview, deferred, brokenLinks, find` at ages of 4, 15, 17, and 33 minutes.
- **A turn received half a sentence.** When the synchronous declaration contract made the compact preamble large, the workstream section was cut to the 182 bytes left, ending mid-word in `Lervo workstream: Deliver the open collaboration platform and kee`.
- **Lervo aged its own workstream.** The commit distance counted every commit since the recorded HEAD. Of 31 commits, 4 were Lervo knowledge commits, 2 were release preparation, and 8 were merges, which pushed the count past the 20-commit threshold.
- **Codex queries never bound, and nested providers could mis-bind.** ADR-0553 bound agent queries through `CLAUDE_CODE_SESSION_ID` only. Codex passes `CODEX_THREAD_ID`, equal to the session identifier its hooks receive, to every command. A provider started inside another inherits the outer variable too, so a Codex command started from a Claude Code session also carries `CLAUDE_CODE_SESSION_ID`.
- **An unclassified failure had no cause anywhere.** `argo` stayed in `knowledge_stage_failure_unclassified`. The stage evidence recorded only that code. The macOS launchd definition had no output path, so the resident's failure lines were discarded. The last log files were from 2026-10-06. On WSL, systemd already keeps them in the user journal.

## Decision

### Terminal turns keep the last projection and label it

A terminal turn accepts a projection made before the latest repository change while it is within the same 20-minute window. The age label says so: `[age 4m, before the latest repository change]`. Operating attention keeps the exact revision binding.

The resident refreshes the projection every five minutes, independent of cycle length, as well as after every cycle. One refresh runs at a time; a request during a refresh runs once more afterward, so a cycle's result is never missed.

### The workstream section fits by whole lines

When the compact workstream section exceeds the remaining budget, it keeps whole lines in order and ends with `Lervo workstream: omitted for space; run \`lervo workstream current\`.` When no line fits, the pointer alone is sent, or nothing.

### Lervo's own commits never age a workstream

The commit distance counts non-merge commits whose author is neither `knowledge@lervo.invalid` nor `lervo-release[bot]@users.noreply.github.com`. It reads `git shortlog --summary --email --no-merges`, one line per author, so the output stays bounded for any range and recent Lervo commits never hide earlier work. No PCRE support is needed.

### Agent queries bind to any provider's own session, never ambiguously

`lervo knowledge query` reads `CLAUDE_CODE_SESSION_ID` for Claude Code and `CODEX_THREAD_ID` for Codex. A named session binds only when that provider's marker for it is open. When exactly one named session has an open turn, the query binds to it. When both do, it binds nothing. An empty, blank, or oversized value binds nothing, never another provider's session. Without either variable, the single-open-turn rule stays.

### Unclassified failures keep their cause

The private stage-failure evidence of an unclassified failure adds `cause: { code, name }`, holding the original error code and error name only when they are identifier-shaped. It never holds the message.

On macOS, the host resident's launchd definition sends output to `~/Library/Logs/Lervo/knowledge-host.log`. The resident bounds that file at startup and every ten minutes: above 4 MiB, it writes the newest 4 MiB to `knowledge-host.log.1` and truncates the file in place. The host service passes the same path to the service manager, which re-renders the definition with it, and creates the log directory first, because launchd does not. Systemd definitions keep logging to the journal and reject a log file.

## Events, states, privacy, and failure meaning

- No event type changes. The health projection, workstream snapshot, and markers keep their shapes.
- The age label is display text only. A projection outside the 20-minute window is still `unknown`.
- `cause` is host-private CAS evidence; it carries no message, path, or prompt text.
- The launchd log holds what the resident already writes to its output streams, bounded to two 4 MiB generations.

## Verification

Focused tests show:

- a terminal reader keeps an earlier-revision projection and the formatter labels it;
- the resident refreshes health three times during a 15-minute cycle, without overlap, and once more after it;
- a crowded workstream section keeps only whole lines and ends with the pointer;
- the commit distance excludes knowledge, release, and merge commits;
- a Codex query binds to its thread while inheriting an outer Claude session, and two open named sessions bind nothing;
- an unclassified cause keeps identifier-shaped code and name only;
- the launchd definition includes the log paths only when given, and systemd rejects them;
- the log bound keeps one previous generation of at most 4 MiB and truncates in place;
- the managed install passes the log path to the service manager and creates its directory.
