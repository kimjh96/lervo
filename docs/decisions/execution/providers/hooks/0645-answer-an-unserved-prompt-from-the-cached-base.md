# ADR-0645: Answer an unserved prompt from the cached base

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0562](../../../foundation/0562-one-relation-web-one-context-assembler-and-a-stop-ledger.md) section 4, which names the unreachable-host record `host_unreachable`
Related: [ADR-0531](0531-bound-terminal-hooks-and-retain-degraded-context.md), [ADR-0636](0636-answer-a-served-prompt-before-recording-it.md)

## Context

Since slice 1 of the [resident context socket](../../../../specifications/execution/stage-observation-and-performance/compact-terminal-context/resident-context-socket.md), a prompt that the context server cannot serve runs in its own process. That process loads the 7 MB runtime, opens the store, and runs Git. The schema-13 `delivery` record shows how often that happens and why.

On the Mac on 2026-11-26, launcher version 5 brought `unreachable` fallbacks down to about 5% of prompts. Prompts still fall back for three reasons:

- `declined_busy`: another session's hook holds the server.
- `unreachable`: the server is paging back in.
- `no_server`: the server is restarting.

With 27 GB of swap in use, a prompt that falls back took several seconds, and the in-process snapshot alone reached 5.6 s.

ADR-0562 already decided what such a prompt gets: the last cached base block, recorded as `host_unreachable`. This record fixes how that works. It names the record `terminal.context.base_delivered` and keeps the cause as its `reason`. A busy server is not an unreachable host, but it gets the same answer.

## Decision

- **The server keeps the cached base current.**
  - After a served prompt has answered, finished its records, and drained, the server prepares the checkout's base context, unless that checkout's base is younger than five minutes. This is ADR-0531's base: the AGENTS.md pointer, publication policy, applied owner rules, and the recorded workstream headline. It reads no snapshot and no knowledge, and it gets one second.
  - The server writes that base as the exact answer line the hook would print, with a notice saying that it is the cached base, when it was prepared, and that the turn records no context. The file is `<store>/base/<key>.json`, replaced atomically, owner-only, and capped like any compact context. `<key>` is the first 16 hex digits of the SHA-256 of the hook's real working directory, its arguments, and the values of the variables the server compares before serving (`HOME`, `CLAUDE_CONFIG_DIR`, `LERVO_USER_STATE_DIRECTORY`, and the rest). Each provider's hook gets its own answer, and a session whose stores differ from the server's never matches one.
  - The server writes no cached base for a checkout that a workspace claims, and removes any it finds there. Workspace attachment can block an assignment's prompt (`TerminalWorkspaceIsolationError`), and a cached answer would skip that check. A plain checkout has no workspace attachment, so it has nothing to block. Workspace provisioning creates a fresh directory. A claim could meet a cached base only if a removed plain checkout's path were reused for a workspace within 30 minutes while no server ran. The next served prompt there removes that base.
- **Which prompts get the cached base.** The launcher answers from the cached base only when all of these hold:
  - the offer failed as `no_server`, `unreachable`, or `declined_busy`;
  - the checkout's file exists, grants no permission to group or others, and is younger than 30 minutes;
  - the hook is a prompt hook. The launcher reads the hook input only after the file passed, so a host without a cached base still never touches stdin before the runtime does;
  - the file reads as a regular file of at most 64 KiB, opened without following links, with the same checks as the runtime.

  Then the launcher prints the file's bytes and exits 0 without loading the runtime. Any other case runs in process as before:
  - a decline for runtime, environment, or request reasons, where running the hook itself is the correct answer;
  - a Stop, which must record its turn;
  - a missing, old, or readable-by-others file.

- **What the launcher records.** It leaves two private files and nothing else.
  - `<store>/base/<key>.<milliseconds>.<pid>.unserved` holds the fallback reason and the cache's age.
  - `<store>/base/<session>.turn`, where `<session>` is the first 16 hex digits of the SHA-256 of the provider session ID, is an empty file whose time says when that session's prompt was answered from the cache.
- **What the server records.** On its next served prompt for that checkout, the server records each marker as a `terminal.context.base_delivered` event, at writer schema 14, and removes it.
  - The event carries the reason, the cache age, and the time. Its actor is `system`, and its run and session are fresh `run_basedelivery_` and `ses_basedelivery_` coordinates. It carries no prompt, path, or session identity.
  - The server records at most 32 markers per prompt. It removes without recording any marker older than 24 hours, any malformed one, and any that falls outside the payload's closed shape. A bad marker never fails the served prompt.
  - Below writer schema 14, the markers are removed unrecorded.
  - Session turn files older than 24 hours are removed.
- **What such a turn does not record.** A turn answered from the cached base records no prepared context. A Claude Stop names no turn, so it would otherwise take the session's latest prepared context, an earlier turn that its own Stop already observed, and record that turn's changes again. A Stop whose session turn file is newer than the session's latest prepared context therefore records nothing and answers `{}`.

## Consequences

- A prompt the server cannot take is answered in milliseconds instead of seconds. It carries the base only: no documents, anchors, health lines, or learned notices.
- Turns answered this way have no turn evidence. The `base_delivered` events count them, so coverage reports can name the gap instead of hiding it. They are recorded only when the same checkout is served again, so the count is a lower bound.
- The cached base can be up to 30 minutes old, and its first line says so. The workstream headline it carries already states that freshness was not inspected.
- The launcher changes behavior, so its version rises. It must stay within its 16 KiB bound.
- Event schema 14 adds one event type. Readers ship first, then the writer and launcher, as for schema 13.

## Verification

- The launcher prints the cached base for the three admitted reasons, and runs in process otherwise: for a Stop, an old or readable-by-others file, a session whose compared variables differ, or a configuration decline.
- The server writes the base after a served prompt drained, refreshes it only after five minutes, keeps none for a claimed checkout, and records markers as events only at writer schema 14.
- A Stop after a prompt answered from the cached base records nothing.
- A `base_delivered` payload outside its closed shape is refused, and the envelope refuses the event below schema 14.
