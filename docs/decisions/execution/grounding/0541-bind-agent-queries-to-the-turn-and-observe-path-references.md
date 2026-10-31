# ADR-0541: Bind agent queries to the turn and observe path references

Status: `accepted`
Decision date: 2026-10-31
Amends: [ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) (agent-run query selection and `Stop` reference detection), [ADR-0538](0538-find-governing-context-through-exact-prompt-anchors.md) (pointer evidence)

## Context

[ADR-0459](../orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md) decided two terminal measurements that were never built:

- an agent-run `lervo knowledge query` records `context.selected` for its returned sources against the current turn;
- on `Stop`, quoting a selected document's path counts as `referenced`, without the E4 token.

On 2026-10-31, `terminal-stop-observation.ts` checked only `lervo-ref:` tokens against `loadedDocuments`. The compact prompt loads no documents, so every compact turn recorded zero references. Lervo could show that it pointed at a document, but never that the agent used one.

## Decision

### Open turns are host-local markers

When `UserPromptSubmit` prepares context, the hook writes one open-turn marker for the repository under `.lervo/state/terminal-integration/open-turns/`. The marker holds:

- the provider;
- `providerSessionDigest` and `providerTurnDigest`;
- the `terminal.context.prepared` event ID;
- the time it opened.

`Stop` removes the marker of its turn. A new prompt in the same session replaces that session's marker, because an interrupted turn never reaches `Stop`. A marker older than 6 hours is ignored and removed by the next hook.

### Agent queries select for the one open turn

`lervo knowledge query` reads the open-turn markers of its repository:

- **Exactly one open turn:** the query records `context.selected` with `origin: agent_query`, the turn's coordinates and context event ID, and each returned source's document ID, path, and content hash. It never records the query text.
- **No open turn, or more than one:** the query records nothing for a turn. Two sessions in one repository therefore never receive each other's selections. Lervo never guesses a binding.

Recording is best effort and bounded. A failure never changes the query's output or exit code.

### `Stop` observes path references

For the closing turn, the selected set is the union of:

- the [ADR-0538](0538-find-governing-context-through-exact-prompt-anchors.md) pointers that reached the context, recorded as `selectedPointers` with path and content hash on `terminal.context.prepared`;
- `context.selected` events with `origin: agent_query` bound to the turn.

A selected document is referenced when the last assistant message contains its repository-relative path exactly. The path must stand alone, bounded by start or end, whitespace, quotes, backticks, brackets, parentheses, or punctuation, and may carry a `:line` suffix. Each such document gets one `terminal.reference.observed` event with `referenceKind: "path_mention"`. Existing `lervo-ref:` token references keep `referenceKind: "output_citation"`.

A path mention proves only that the reply named the document. It does not prove that the agent read or relied on it. Reports label it as a proxy, as ADR-0459 requires for hit precision.

## Events, states, privacy, and failure meaning

- `terminal.context.prepared` gains optional `selectedPointers: [{ path, contentHash, kind }]`, with at most 3 entries. Readers tolerate its absence on historical events, following [ADR-0208](../providers/0208-additive-terminal-observation-schema-compatibility.md).
- `context.selected` gains `origin: hook | agent_query | managed_turn`. An agent-query selection additionally carries `providerSessionDigest`, `providerTurnDigest`, and `contextEventId`.
- `terminal.reference.observed` accepts `referenceKind: "path_mention"`.
- `terminal.turn.observed` gains `selectedCount` and `pathMentionCount`.
- Markers are host-private and never published. Events carry document IDs, paths, hashes, and digests, never prompt, query, or reply text.
- An unreadable marker directory means no binding. It is not an error.

## Verification

Focused tests must show:

- a query during one open turn records `context.selected` with `origin: agent_query`, bound to that turn, without query text;
- a query with zero or two open turns records nothing for a turn;
- `Stop` records `path_mention` for a selected path quoted alone, with or without `:line`, and never for a substring of a longer path or for an unselected path;
- `Stop` removes its own marker, and stale markers expire;
- a compact turn with an ADR-0538 pointer whose path the reply quotes counts one reference.

Installed verification must show, in `axli`, a Claude Code turn that runs `lervo knowledge query` and quotes a returned path, recorded as one `agent_query` selection and one `path_mention` reference.
