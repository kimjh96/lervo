# Invocation and authority

The owner prompt includes the observed UTC timestamp to interpret mandate and lease deadlines across local calendar boundaries. This neither changes the semantic reuse basis nor grants authority; canonical admission checks the actual deadline before effects.

`SupervisedOwnerReasoningV1` defines `work.owner_reasoning.v1` with twelve required fields: `schemaVersion`, `kind`, `basisHash`, `contextArtifactHash`, `roleId`, `roleVersion`, `roleContractHash`, `provider`, `requestedModel`, `reservedTokens`, `attemptNumber`, and `deadline`.

Invocation uses `execute_as_owner`, adds one concurrent provider attempt, and reserves the greater of the configured token amount and the mandate's per-attempt ceiling. This prevents a small configured reservation from admitting a call whose ordinary observed usage could exceed the remaining aggregate allowance. Invocation grants no assignment, worker, write path, or business effect. Canonical decision and resource admission precede invocation.

Repeated calls for the same task basis must follow a recorded sequence of at most three attempts, further limited by the mandate. Provider-reported usage may exceed a reservation: the admission ceiling is not a physical provider cutoff. Any overrun remains charged and blocks later calls.

A reviewed V3 `ownerSpendAllowance` may impose an independent incremental reservation ceiling even when the mandate's aggregate policy is `per_attempt_only`. Its exact project and revocation event ID/hash anchor one owner lineage; derived successor mandates inherit the same allowance. Before reserving and again before provider start, the Node reads the verified project event chain and exact owner decision artifacts after that anchor. Every recorded owner-reasoning decision retains its full reserved amount, including safe non-starts; no model-dependent usage conversion or implicit refund occurs. An unavailable usage receipt or observed usage exceeding its reservation stops further starts pending review. A missing anchor, changed chain, corrupt plan, omitted current decision, or exceeded ceiling also fails closed. The initial reservation is fenced against an event-head change. A renewed, revoked per-attempt mandate cannot silently omit the reviewed allowance. This is an admission bound, not a physical provider token cutoff or a claim about historical actual use.

## Readiness

Owner readiness checks the exact role, current task facts, source bytes, result artifacts, configured native executable, model selection, and isolated login profile. The managed coordinator narrows the registered role to `read_only`; it neither invents another role nor bypasses write approval.

The current path supports machine-facing roles with no unresolved default skills and only the repository-instruction rule. Additional skill, context, and presentation requirements remain blocked.

## Execution lifecycle

The adapter records one deterministic `managed.execution.reserved` key before calling the provider. An existing execution key requires inspection and prohibits invoking the model again.

Native startup rechecks owner authority, task context, resource sources, and the owner fence. Invocation has a maximum three-minute deadline and observes revocation while active through the incremental authority reader. It is neither an idle model nor a full-history polling loop. Runtime shutdown and authority loss cancel the managed invocation.

Owner reasoning explicitly selects machine JSON result projection. The provider returns one JSON object; any required evidence comments occupy standalone decoded lines in a string value such as `rationale`. The common adapter contract parses JSON before checking those strings against the ordinary exact-document reference policy. It rejects malformed JSON (`json_parse_failed`) and known evidence tokens used inline before recording any reference evidence; unknown or ineligible documents cannot produce receipts. Valid comments produce deduplicated E4 output-citation receipts and are removed from the published JSON while its structure is retained. Raw result capture and projected artifact hashes remain distinct; operational events retain neither body nor prompt. Human Markdown results keep their existing projection.
