# Invocation and authority

The owner prompt includes the observed UTC timestamp to interpret mandate and lease deadlines across local calendar boundaries. This neither changes the semantic reuse basis nor grants authority; canonical admission checks the actual deadline before effects.

`SupervisedOwnerReasoningV1` defines `work.owner_reasoning.v1` with twelve required fields: `schemaVersion`, `kind`, `basisHash`, `contextArtifactHash`, `roleId`, `roleVersion`, `roleContractHash`, `provider`, `requestedModel`, `reservedTokens`, `attemptNumber`, and `deadline`.

Invocation uses `execute_as_owner`, adds one concurrent provider attempt, and reserves the greater of the configured token amount and the mandate's per-attempt ceiling. This prevents a small configured reservation from admitting a call whose ordinary observed usage could exceed the remaining aggregate allowance. Invocation grants no assignment, worker, write path, or business effect. Canonical decision and resource admission precede invocation.

Repeated calls for the same task basis must follow a recorded sequence of at most three attempts, further limited by the mandate. Provider-reported usage may exceed a reservation: the admission ceiling is not a physical provider cutoff. Any overrun remains charged and blocks later calls.

## Readiness

Owner readiness checks the exact role, current task facts, source bytes, result artifacts, configured native executable, model selection, and isolated login profile. The managed coordinator narrows the registered role to `read_only`; it neither invents another role nor bypasses write approval.

The current path supports machine-facing roles with no unresolved default skills and only the repository-instruction rule. Additional skill, context, and presentation requirements remain blocked.

## Execution lifecycle

The adapter records one deterministic `managed.execution.reserved` key before calling the provider. An existing execution key requires inspection and prohibits invoking the model again.

Native startup rechecks owner authority, task context, resource sources, and the owner fence. Invocation has a maximum three-minute deadline and observes revocation while active through the incremental authority reader. It is neither an idle model nor a full-history polling loop. Runtime shutdown and authority loss cancel the managed invocation.
