# ADR-0553: Bind terminal observations to the provider session and the first turn

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0541](0541-bind-agent-queries-to-the-turn-and-observe-path-references.md) (agent query binding), [ADR-0542](0542-observe-native-skill-use-instead-of-repeating-skill-disclosure.md) (transcript range start)

## Context

On 2026-11-01, installed verification of 0.23.2 in `axli` and `flemo` ran real Claude Code turns against the ADR-0538, ADR-0541, and ADR-0542 criteria. The ADR-0538 pointers passed in both repositories. Two measurements failed.

**First turns never observed skill use.** Claude Code creates a session's transcript only after the first `UserPromptSubmit` hook returns. A probe hook found the file absent at the first prompt and present at the second. The prompt hook therefore recorded no start position, and the resident assessed every first turn as `unavailable`. Before this check, 27 of 35 assessed turns in `axli` and 16 of 31 in `lervo` were `unavailable`. A first-turn `eli5` invocation produced no `terminal.skill.observed` event. The same invocation on a second turn produced one.

**One stale marker silenced every agent query.** ADR-0541 binds an agent-run query only when exactly one open turn exists. An interrupted turn keeps its marker for six hours. While one marker from an interrupted turn remained in `axli`, a turn that ran `lervo knowledge query` and quoted a returned path recorded no `agent_query` selection and no `path_mention` reference. Before this check, `axli` had zero `agent_query` selections in total.

**File-history records voided whole turns.** The resident rejects a range when any Claude entry lacks the turn's session. Claude Code writes `file-history-snapshot` and `file-history-delta` records without `sessionId`. The 38 most recent local transcripts held 3,643 and 848 of them. Any turn that tracked a file edit was therefore `unavailable`.

Claude Code passes `CLAUDE_CODE_SESSION_ID` to every command it runs. The value equals the `session_id` its hooks receive.

## Decision

### A transcript created during the turn starts at zero

When the prompt hook finds no transcript at the provider's path, it records that path as `transcriptAbsent` on the open-turn marker. The path must be absolute and inside the provider's transcript directory, and the file must be missing (`ENOENT`). Any other failure records nothing, as before.

At `Stop`, a proven marker with `transcriptAbsent` starts the range at offset 0 of the transcript that now exists, when `Stop` names the same path. Everything in a file created after the prompt belongs to this turn. Because that start prefix is empty, the resident also verifies the `Stop` position's own prefix digest before and after reading, for every turn. The resident keeps every existing check: the file stays inside the provider directory and owned by the user, its device and inode match the `Stop` position, and every Claude entry carries the turn's session.

### File-history records are not turn content

The resident skips Claude entries of type `file-history-snapshot` and `file-history-delta`. They carry no session and no tool use, so they can neither void a range nor contribute an invocation. Every other entry still must carry the turn's session.

### Agent queries bind to the calling session

`lervo knowledge query` reads `CLAUDE_CODE_SESSION_ID` from its environment. When it is set, the query binds only to that session's Claude marker, whatever other sessions have open. When that session has no open turn, or the value is empty, blank, or longer than 512 characters, the query records nothing for a turn and never falls back to another session. Without the variable, including every Codex turn, the ADR-0541 rule stays: exactly one open turn, or nothing.

The variable never leaves the host. Events carry only the existing session digest.

## Events, states, privacy, and failure meaning

- The open-turn marker gains optional `transcriptAbsent`, an absolute provider transcript path. It is host-private, like the marker, and never published. Readers accept markers without it.
- No event changes shape. A first turn that was `unavailable` can now be `observed`, `truncated`, or still `unavailable` when `Stop` names another path or the file fails a check.
- A wrong or foreign `CLAUDE_CODE_SESSION_ID` finds no marker, so it records nothing. It cannot bind a query to another session's turn without that session's identifier.

## Verification

Focused tests must show:

- a first turn whose transcript is absent at the prompt and created before `Stop` records one `terminal.skill.observed` with `skillTelemetry: observed`;
- the same marker with `Stop` naming another transcript stays `unavailable`;
- file-history records without a session do not void a first turn's range;
- an in-place, same-length rewrite of a first-turn transcript after `Stop` is `unavailable`;
- an empty, blank, or oversized session never binds to another session's single open turn;
- a query with `CLAUDE_CODE_SESSION_ID` binds to that session's turn among three open sessions;
- a query whose session has no open turn records nothing, even when another single turn is open.

Installed verification must show, in `axli` with another session's marker present, a first Claude Code turn that invokes `eli5` recorded as one provider-transcript `terminal.skill.observed`, and a turn that runs `lervo knowledge query` and quotes a returned path recorded as `agent_query` selections and one `path_mention` reference.
