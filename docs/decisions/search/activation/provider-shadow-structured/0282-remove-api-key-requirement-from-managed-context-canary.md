# ADR-0282: Remove the API-key requirement from the managed-context canary

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0281](0281-prepare-managed-context-canary-v2.md) prepared a paired checkpoint whose Codex selection turns use an opt-in Responses API transport. Although this transport can prove a no-tool boundary, it requires a separate API credential. Making that credential an activation prerequisite would require ordinary Lervo users to configure another secret despite Codex and Claude having reusable native signed-in sessions.

The passed [V18](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md) contains 32 exact, provider-specific selection observations over the reviewed four-case population. Each binds the source manifest, candidate envelope, selected document versions, provider, model, duration, usage, replay result, and passed review. Repeating these calls would retest the fixed selector rather than measure the effect of loading and injecting selected sources into ordinary task turns.

## Decision

Keep the Responses no-tool transport as optional internal BYOK or CI behavior. It is not the primary activation path, and no public Lervo workflow requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

Prepare a new immutable v3 task-only checkpoint for the same eight paired source tasks. For each task, bind the exact passed V18 observation for that provider and project its exact selections onto the current managed linked-candidate set. Add a V18-selected source only if it remains an exact current candidate, and do not duplicate sources already in ordinary lexical or graph context. Fail provider-free preparation on any manifest, review, observation, candidate-envelope, document-version, provider, model, or projection mismatch.

V3 makes zero selection calls. Its only possible provider effects are eight Codex and eight Claude read-only task calls through ordinary provider adapters and existing native signed-in sessions, for a 16-call ceiling. It permits no retry, repair, fallback, replacement, write, external message, Hub, direct-terminal, operational-search, or production effect. V2 remains immutable and unexecuted with zero calls; v1 remains terminal failure evidence.

The frozen V18 records remain historical selection evidence. V3 must not claim that a current task provider selected those sources or assign historical adapter receipts or usage to a current selection turn. Current-run evidence starts with exact source reload, managed selection application, loading, injection, and final reference. `selected`, `loaded`, `injected`, and `referenced` remain distinct; no internal `used` claim is allowed.

The prepared v3 manifest remains non-executable until exact operator authority binds its final digest and source/build snapshot. This decision and provider-free preparation make no live call.

## Outcome

Provider-free preparation produced manifest `sha256:b93952d09b44e77223cd5b217480e0af1dda748ae548d0dc65ca1e3717dbf0cc` with zero calls and exact replay. All evidence bindings passed, but projection retained no additional sources in any of the eight Codex runs and only one source in one of the eight Claude runs because V18 mostly selected sources already present in ordinary context.

V3 is therefore rejected before execution because it would not measure a comparable linked-context effect. Its owner-only manifest remains preserved and cannot be authorized, resumed, retried, repaired, or used as a performance sample.

## Consequences

The normal product path reuses provider-native authentication and does not request API keys. V3 showed that freezing earlier selections does not create an effect-bearing task population. A successor needs a provider-neutral, deterministic linked-selection rule while retaining zero selection calls.

The potential reduction from 32 calls to 16 is design-level only, not measured task speed, token, billing, quality, or cost savings.

The task-only canary is intended to measure whether exact V18-selected linked context improves ordinary Codex and Claude task results. Its final report may compare speed, reference quality, answer quality, and provider-reported usage only after all 16 task runs satisfy the unchanged acceptance gates.

## Verification

- Prove exact V18 manifest, passed review, observation-file, candidate-envelope, selected-version, provider, and model bindings for all 16 scheduled task runs.
- Prove zero selection calls, a 16-call total ceiling, no selection transport, no credential field, no provider calls during preparation, and owner-only exact replay.
- Prove current projections reject missing, stale, or mismatched frozen evidence before any task adapter can be created.
- Run focused checkpoint tests, repository quality and full checks, documentation lifecycle, knowledge migration and lint, and exact-base release completion.

## References

- [V1 stop decision](0279-stop-managed-context-canary-v1-on-command-signal.md)
- [Optional Responses transport](0280-add-an-opt-in-codex-responses-no-tool-transport.md)
- [V2 checkpoint](0281-prepare-managed-context-canary-v2.md)
- [V18 evidence](../../../../evidence/search/provider-shadow/linked-evidence-provider-shadow-pilot-v18.md)
- [Provider adapter specification](../../../../specifications/execution/provider-adapters.md)
