# ADR-0305: Bind terminal grounding to native structured output

Status: `accepted`

## Context

Direct Codex and Claude terminal hooks reserve 20 seconds of a 30-second hook budget for same-provider typed request grounding. Claude returned valid JSON text only after that deadline, while native structured output returned the same proposal within budget. The timeout caused unmanaged abstention and blocked relevant publication selection despite provider contract compliance.

The abstention path also ran an invented generic repository query before discarding its hits. Telemetry could report recommendations while inferring selection and loading from grounding readiness rather than observed selected documents, obscuring the failure.

## Decision

The common no-capability JSON runner binds the complete response schema through each provider's native interface. Codex receives a mode-`0600` temporary `--output-schema` file and low reasoning effort. Its native schema projection infers constant types, uses supported union syntax, and removes unsupported size, uniqueness, and pattern annotations. Deterministic validation against the original complete contract remains authoritative. Claude receives the canonical schema through `--json-schema` with low effort. Both run in an empty temporary directory under existing tool, MCP, browser, session, and user-configuration restrictions.

Claude native structured output ends with provider metadata `stop_reason: tool_use` and at least two provider-reported turns despite invoking no external capability. Lervo accepts this only when native `structured_output` exists, the final result parses to identical canonical JSON, permission denials are empty, and web-search and web-fetch counts are zero. Legacy Claude compilation without native schema binding retains the one-turn `end_turn` requirement. Deterministic proposal validation remains authoritative for both providers.

The 20-second grounding budget remains unchanged. Grounding translates retrieval queries into the repository policy's publication language while preserving exact identifiers and protocol coordinates. This permits cross-language retrieval of canonical publications without keyword, alias, or phrase maps. A non-ready grounding decision performs no repository query and selects no publication. A ready decision without a retrieval coordinate also performs no query. Terminal context exposes `grounding_not_ready`, `retrieval_query_missing`, `no_candidates`, or `selected`. Selection and loading telemetry derives from observed selected documents, not grounding status. No generic query, keyword map, alias map, or phrase router is introduced.

## Consequences

Same-provider grounding uses the fastest provider-supported schema channel without granting filesystem, command, network, browser, MCP, or session capabilities. Invalid, mismatched, or late output remains `semantic_resolution_failed`; unmanaged terminals abstain, and managed consumers fail closed. Candidate, selection, loading, hook preparation, provider delivery, and provider use remain separate claims.

## Verification

- Common Codex and Claude runner tests assert native schema binding and low-effort arguments.
- Claude tests distinguish native structured-output metadata from forbidden external tool use and retain legacy no-tool enforcement.
- Terminal integration tests prove failed grounding performs no selection and reports zero candidates and selected documents.
- Cross-language terminal checks prove Korean requests produce publication-language retrieval queries and select current English publications without a keyword map.
- Fresh Codex and Claude terminal sessions must retrieve and cite relevant current repository publications before release completion.

## References

- [Typed semantic request grounding and terminal stage evidence](0237-typed-semantic-grounding-and-terminal-stage-evidence.md)
- [Unmanaged terminal grounding failure abstention](0239-unmanaged-terminal-grounding-failure-abstention.md)
- [Typed semantic request grounding specification](../../../specifications/execution/semantic-grounding.md)
