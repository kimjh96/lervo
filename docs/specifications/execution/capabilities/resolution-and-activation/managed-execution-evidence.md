# Managed execution evidence

- `capability.recommended` records the query digest, score, and reason codes.
- `capability.selected` records explicit, role-default, natural-language, or dependency selection.
- `capability.loaded` proves current package validation.
- `capability.activated` proves only provider connection or plugin load.

For a skill, Lervo reloads and rehashes `SKILL.md`, places its exact verified instructions in the provider turn, emits `skill.invoked`, and emits `skill.completed` only after storing a result artifact.

For MCP, an exact normalized `mcp__<server>__*` provider tool signal bound to confirmed activation emits privacy-bounded `capability.invoked` or `capability.completed` alongside `tool.called`.

Plugins receive no invocation claim unless a future adapter supplies an equally exact binding. These events prove observable orchestration, not model attention, understanding, or semantic reliance.
