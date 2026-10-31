# Managed context evidence

`context.selected` accepts `origin: managed_turn` for managed preparation and measurement, `hook` for hook selections, and `agent_query` for an explicitly bound terminal query. Historical selections may omit origin. Agent-query coordinates, privacy, and failure meaning follow the [terminal observation contract](../terminal-observations/context-reference-and-turn-evidence.md). Selection alone establishes no load, injection, or internal use.

Managed `context.injected` events include adapter and provider session and, for every document, E3 receipt, ID, hash, and scope. `adapter.result.captured` records adapter, provider session, turns, digest, bytes, media type, and reference support without content. `context.referenced` records validated E4 linked to that result and E3 version.

Unknown, stale, altered, cross-turn, or cross-generation tokens create no E4. Contradictory persisted coordinates fail projection. Result and E4 events commit atomically; failure fails the run.

Local trace and Hub use one projector; Hub coverage uses complete history despite response pagination.
