# Context, reference, and turn evidence

`terminal.context.prepared`, `terminal.reference.observed`, and `terminal.turn.observed` retain:

- Opaque IDs and domain-separated request and retrieval digests.
- Typed grounding status, workflow/source/subject/provider identifiers, and bounded reason codes.
- Candidate counts, repository-relative coordinates, hashes, assurance, freshness, lifecycle state, and reference availability.
- Prepared and final repository revisions and the derived changed flag.
- Final verified workstream ID, revision, and snapshot hash.

Direct unmanaged prompt preparation uses grounding reason `unmanaged_terminal_retrieval_only` with empty semantic-action coordinates. The preparation event distinguishes candidate selection, hash-bound loading, hook preparation, provider injection (`unobserved`), and provider use (`unknown`). Hook-side preparation never establishes delivery or use.

Under [ADR-0541](../../../../decisions/execution/grounding/0541-bind-agent-queries-to-the-turn-and-observe-path-references.md), preparation also records optional `selectedPointers`, at most three `{ path, contentHash, kind }` entries. Kinds are `skill`, `decision`, and `instruction`. Only whole pointer lines delivered by compact assembly enter this set. The hook never loads their bodies.

Preparation writes a host-private open-turn marker under `.lervo/state/terminal-integration/open-turns/`. It contains the provider, session digest, nullable turn digest, prepared context event ID, and opening time. Stop removes its own marker. Hooks remove markers older than six hours. Reads inspect at most 128 entries and 8 KiB per marker; an unreadable, malformed, unsafe, or over-budget directory yields no query binding. Markers never enter events or publication.

An agent-run knowledge query records one `context.selected` per returned source only when the same open turn resolves before retrieval and before recording. With `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID` set, that turn is the open marker of the named provider session, whatever other sessions have open; when both name sessions with open turns, nothing binds ([ADR-0553](../../../../decisions/execution/grounding/0553-bind-terminal-observations-to-the-provider-session-and-the-first-turn.md), [ADR-0555](../../../../decisions/execution/applications/0555-keep-operating-signals-visible-and-honest.md)). Without either, the turn is the single open turn. It carries `origin: agent_query`, path-derived `documentId`, source `conceptId`, path, hash, provider digests, and `contextEventId`. Without a provider session, zero or multiple open turns produce no turn selection; with one, a session without an open turn produces none. Recording failure leaves query output and exit status unchanged. The query records at most its 20 returned hits and stores no query text.

At Stop, the selected set is the union of delivered pointers and agent-query selections with matching context, provider, session, and turn coordinates. Repeated selections of a path count once; the latest selection supplies its hash. Each selected path named exactly in the last assistant message produces one `terminal.reference.observed` with `referenceKind: path_mention` and path-derived `documentId`. Source `conceptId` is retained when available. The path must stand alone between message boundaries, whitespace, quotes, backticks, brackets, parentheses, or punctuation. A numeric `:line` suffix is accepted. A substring within a longer path creates no reference.

Existing hash-bound `lervo-ref:` citations against loaded documents retain `referenceKind: output_citation` and their required concept identity. A document with both forms produces one event for each form. `referenceCount` counts reference events. `selectedCount` counts distinct selected paths; `pathMentionCount` counts path-mention events. A path mention is a reference proxy and proves neither reading nor reliance.

For a direct root session, `lifecycleStatus: action_required` may coexist with `completionResult: allowed`: the former is an observed repository finding; the latter means the audit did not claim authority to block provider availability. Attached-worker isolation may still record `blocked`. Empty hook success after an internal failure creates neither an event nor inferred success.

### Turns that end without a Stop hook (schema 12)

Claude runs no Stop hook for an interrupted turn, in the terminal (Esc) or in the ADE. Schema 12 lets `terminal.turn.observed` record how a turn ended in an optional `ending`:

- `stop_hook`: the Stop hook ran. An absent `ending` means the same, so every earlier record keeps its meaning.
- `next_prompt`, `session_end`, `session_start`: the open turn is settled when the same session's next prompt, end, or start arrives.
- `provider_interrupt`: the provider reported the interrupt directly.

The Stop gate checks completion only at a Stop hook. Every other ending therefore records `completionResult: not_checked`, and a Stop-hook ending never does. The event screen refuses any other pairing, so no reader can count a turn the gate never saw as `allowed`. Below schema 12, the envelope refuses `ending` and `not_checked`, so older readers never receive them. The terminal coverage report shows such a turn's completion as `not_checked`.

The writer settles a turn that no Stop hook closed while the writer selects schema 12:

- **Request.** A hook that finds the same session's open-turn marker still open writes a settlement request under the repository's `.lervo/state/terminal-integration/turn-settlements/`. The marker must also name the same checkout, by `executionRootDigest`; a marker from before that field counts for any checkout. The next prompt writes one with `ending: next_prompt` before its marker replaces the old one, and a session start writes one with `ending: session_start`. The hook does nothing else, so a prompt pays only a directory check.
  - Requests are idempotent by the turn's context event.
  - They are bounded as markers are: 128 entries, each expiring after six hours.
- **Worker.** The hook starts a detached worker from the hook runtime (`settle-turns`). A prompt, a session start, and a Stop each start it while any request waits, so a request whose worker never ran is picked up by the session's next hook.
- **Record.** The worker first looks for a `terminal.turn.observed` that already cites the context event, through the type index. If one exists, as when a Stop recorded but failed to remove its marker, the request settles to nothing. Otherwise it records the turn:
  - The event ID derives from the context event, so two settlements record once.
  - `ending` is the request's, and `completionResult` is `not_checked`.
  - Selections are counted, and `referenceTelemetry` is `unavailable`, because no Stop hook passed the turn's last message.
- **Repository change.** The change is the difference between the turn's prompt-time snapshot and the snapshot of the moment it is settled: the next prompt's prepared snapshot, or a snapshot the worker takes for a session start. So it does not move with what the next turn does meanwhile. Files edited by hand between the interrupt and that moment are attributed to the interrupted turn, and no attempt is made to split them. In a main checkout the change is recorded as `repository.change.completed`, so knowledge jobs see it; a linked worktree records none (ADR-0633).
- **Lifecycle.** `lifecycleStatus` is the lifecycle observed when the turn was settled: the worker inspects it against the turn's prepared expectation. It is the only part that reads live state, so it may reflect the next turn's early edits.
- **Assessment.** The turn is queued for its skill assessment, as a Stop-observed turn is, so the practice-usage projection counts it.
- Below writer schema 12, no request is written, and the next prompt replaces the marker as before.

`terminal.turn.declared` retains an opaque declaration and context ID, exact repository revision, task mode, canonicalization and knowledge dispositions, deliberation disposition, optional completed-deliberation ID, and time.

These terminal events exclude prompts, retrieval-query text, bodies, final responses, transcripts, summaries, raw coordinates, configuration, secrets, and absolute paths. Agent declarations do not prove internal reasoning.

## Verification procedure

Focused regressions cover single, absent, and ambiguous open turns; expiry and exact marker removal; selected path boundaries and line suffixes; duplicate selections; citation compatibility; additive schema groups; and compact references with no loaded body. This task writes these tests without executing them.

Installed acceptance remains a separate check. In `axli`, use a Claude Code turn that runs `lervo knowledge query` and quotes one returned path in its final message. Inspect canonical events for one `context.selected` with `origin: agent_query`, the prepared context ID and matching digests, then one `terminal.reference.observed` with `referenceKind: path_mention` for that path and hash. Confirm the closing event and coverage show one selection and one path mention, and that the marker is removed. Retain repository revision, installed build, event IDs, and hashes as evidence. Query or reply text must not appear in the events. This implementation task does not execute installed acceptance.
