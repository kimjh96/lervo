# Execution and profile evidence

Typed semantic grounding precedes selection and effects.

```text
causal work admitted -> requested -> resolved -> documents/capabilities recommended and selected
-> bytes loaded -> context prepared -> provider started
-> context injected -> capabilities activated / skills invoked -> provider turn
-> provider result observed -> repository verified -> completed
```

Completion requires agreement among contracts, capability decisions, context evidence, provider results, repository snapshots, and verification. Other provider work is `unmanaged`.

After a managed provider turn and its verification phase return, a schema-v2 writer records `role.profile.activated` with provider, exact resolved role ID and version, role-contract and effective-profile hashes, actual runtime-profile hash, source kind, and time.

A repository still selecting writer v1 continues without profile-activation evidence; that run is ineligible for an agent-profile candidate. Event append failure under v2 fails the command.

The event excludes role text, prompts, paths, output, credentials, native session IDs, and user identity. It proves only that the managed provider/verification phase used those resolved coordinates, not attention, semantic reliance, quality, publication, or whole-run completion.
