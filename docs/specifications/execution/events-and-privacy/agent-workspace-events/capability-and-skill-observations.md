# Capability and skill observations

## Recommendation, selection, and loading

`capability.recommended` retains capability coordinates, numeric score, bounded reason codes, and a query digest; it excludes the natural-language request and package prose.

`capability.selected` retains the selection reason.

`capability.loaded` retains source scope and a validation digest but excludes local paths and package bytes.

## Skill execution

`skill.invoked` is recorded only when the run's instructions contain the verified skill body. A host that only resolves skills, such as the Node managed-provider host under [ADR-0156](../../../../decisions/execution/providers/0156-managed-provider-skill-resolution.md), records `skill.resolved` alone. `skill.invoked` binds skill ID, version, request digest, and declared capability names. `skill.completed` binds status and result-artifact coordinates. Missing completion means failure or unobserved completion, never success.

None of these capability or skill events proves attention, understanding, correctness, or semantic reliance.

## Capability execution

`capability.invoked` and `capability.completed` are emitted only for a normalized MCP tool name exactly matching the server name in a confirmed activation. They retain package coordinates, a provider-item digest, input digest or terminal status, and duration. They exclude tool names, arguments, output, server configuration, and credentials. A provider plugin has no invocation event without adapter-supplied exact binding.
