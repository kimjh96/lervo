# Execution and profile evidence

Typed semantic grounding precedes selection and effects.

```text
causal work admitted -> requested -> resolved -> documents/capabilities recommended and selected
-> bytes loaded -> context prepared -> provider started
-> context injected -> capabilities activated / skills invoked -> provider turn
-> provider result observed -> repository verified -> completed
```

Completion requires agreement among contracts, capability decisions, context evidence, provider results, repository snapshots, and verification. Other provider work is `unmanaged`.

## Profile activation

After a managed provider turn and its verification phase return, a schema-v2 writer records `role.profile.activated` with:

- Provider.
- Exact resolved role ID and version.
- Role-contract and effective-profile hashes.
- Actual runtime-profile hash.
- Source kind and time.

A repository selecting writer v1 continues without profile-activation evidence; the run is ineligible for an agent-profile candidate. Event append failure under v2 fails the command.

The event excludes role text, prompts, paths, output, credentials, native session IDs, and user identity. It proves only that the managed provider/verification phase used those resolved coordinates, not attention, semantic reliance, quality, publication, or whole-run completion.

## Provider-model identity

The adapter turn result, `adapter.result.captured`, managed-run result, and `resource.usage.recorded` retain one provider-model identity containing:

- Configured requested model.
- Provider-observed answer model.
- All observed model identifiers.
- Observation source.
- Explicit unavailability reason.

Resource-accounting descriptor v2 names its static configuration coordinate `requestedModel`; it never presents that value as observation. The answer model must occur in the observed set. Configuration, an alias, a null value, and an auxiliary usage identifier never substitute for provider observation.

Conversation resolution and its replay artifact retain the same identity unchanged.

## Observation-only managed turns

A managed-run caller may explicitly set `executionMode: read_only` to narrow an otherwise write-capable role for a reasoning or observation turn. This option cannot widen a role. It requires no expected write paths and rejects a write-approval payload.

The provider start request retains the actual role identity but requests read-only execution. Existing session/result validation and the managed-write boundary still apply; a write-approval requirement is not requested for that turn. Omitting the option retains normal role-derived execution behavior. This option does not itself compose production owner planning or grant any subsequent effect.
