# Invocation and authority

The owner prompt includes the observed UTC timestamp to interpret mandate and lease deadlines across local calendar boundaries. This does not change the semantic reuse basis or grant authority. Canonical admission checks the actual deadline before effects.

`SupervisedOwnerReasoningV1` defines `work.owner_reasoning.v1` with twelve required fields: `schemaVersion`, `kind`, `basisHash`, `contextArtifactHash`, `roleId`, `roleVersion`, `roleContractHash`, `provider`, `requestedModel`, `reservedTokens`, `attemptNumber`, and `deadline`.

Canonical decision and resource admission precede invocation. Invocation uses `execute_as_owner`, adds one concurrent provider attempt, and reserves the greater of the configured token amount and the mandate's per-attempt ceiling. This prevents a small configured reservation from admitting a call whose ordinary observed usage could exceed the remaining aggregate allowance. Invocation grants no assignment, worker, write path, or business effect.

Repeated calls for the same task basis must follow a recorded sequence of at most three attempts, further limited by the mandate. Provider-reported usage may exceed a reservation: the admission ceiling is not a physical provider cutoff. Any overrun remains charged and blocks later calls.

- [Owner spend allowance](invocation/allowance.md): independent reservation ceiling and lineage checks.
- [Readiness](invocation/readiness.md): required checks and supported roles.
- [Execution lifecycle](invocation/lifecycle.md): reservation, authority, cancellation, and result projection.
