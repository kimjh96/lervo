# Readiness and failure meaning

The optional `supervision` component in the owner-only Node health snapshot uses `pending`, `ready`, `disabled`, and `unavailable`. A configured service starts pending. Observed cycles report service readiness under these rules:

- Blocked or uncertain cycles report `supervision_attention_required` with the cycle's bounded attention `reasonCodes`: at most 16 identifier codes, such as `readiness_tools_failed` or `responsibility_lease_unresolved`.
- Cycle exceptions report `supervision_cycle_failed` with one bounded `reasonCodes` entry derived from the error's code or class name. For each failed cycle, the service writes one error-stream line naming that code, the error class, and the first 200 characters of its message.
- A completed goal whose next action is publication but which has no publication origin reports `local_result_canonical` instead of `owner_plan_unavailable`. Every locally bound goal has no publication origin; its accepted result stays canonical in the repository, and nothing is missing.
- An effect that failed after invocation reports `effect_outcome_uncertain` plus the adapter's bounded failure code, if present. The managed worker boundary distinguishes `managed_output_bound_exceeded`, `managed_revalidation_failed`, `managed_deadline_elapsed`, `managed_cancelled`, `managed_stdin_failed`, `managed_launch_failed`, `managed_process_failed`, `managed_dispatch_evidence_missing`, and `managed_outcome_unreconciled`. None includes child output.

These observations describe runtime operation, not accepted task completion or delivered user results. Aggregate health remains starting while supervision is pending and degraded when it is unavailable.

An idle or busy cycle without a fresh report preserves the preceding health observation. It cannot clear an unavailable state merely because no owner observation ran.

Health retains only bounded status, failure, and reason codes. It excludes task prose, prompts, source bodies, credentials, transport addresses, and provider errors. Failure to persist runtime health resolves the service failure signal, causing Node shutdown with `supervision_runtime_failed`. An ordinary task or effect failure remains available for the existing bounded recovery loop. Transport health does not replace supervision health.

Configuration, startup, local failure handling, health aggregation, and existing runtime regression tests cover this composition. Positive installed operation, reviewed activation, natural Discord intake, and the complete acceptance journeys remain separate evidence requirements.
