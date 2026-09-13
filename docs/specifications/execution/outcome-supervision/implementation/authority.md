# Authority and exact effects

`OperatingMandateV1` carries appointing authority, accountable agent, repository and team scopes, permitted actions, role scope, capability ceiling, path roots, providers, capacity, token reservations, retry bounds, deadlines, expiry, and revocation coordinate. `OperatingMandateV2` adds a [designated execution host](execution-host.md) while retaining those limits. Its content hash is separate from its reviewed installation hash. Neither arbitrary JSON nor a model-authored plan proves installation. The [installation path](storage/installation.md) records a reviewed mandate against verified repository sources; cross-device history reconciliation and production effect admission remain separate work.

`OperatingPolicyReviewV1` uses `mandate_policy_v1` and binds the exact plan, current graph, source digest, admission snapshot, installation review, and reviewer policy. This separate review contract cannot serve as a human reviewer identity in the old topology CLI. `admitted` proves only a policy decision.

The effect adapter derives `effectAdmissionHash` from the actual effect payload's action, contract, artifact, role, capabilities, paths, provider, additions, concurrency, attempt number, reservation, and deadline. Copying proposal values is not verification; the controller rejects disagreement. Unsupported effect mappings, absent capacity or usage, invalid ancestry, divergent history, revocation, stale sources, and scope or budget overflow block admission.

The authority adapter must validate current installation and revocation sources and apply the minimum of the mandate and existing workforce, graph, resource, provider, and workspace policy. Admission observations older than five seconds or from the future cannot reach the composition's effect call.

The executor must recheck authority and fence the exact payload at its commit boundary. The composition's prior check cannot prevent an external change during an effect call.

The [automatic topology adapter](automatic-topology.md) persists one policy-reviewed structural addition and preserves the separate manual approval path.
