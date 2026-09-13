# Readiness and failure meaning

The optional `supervision` component in the owner-only Node health snapshot uses `pending`, `ready`, `disabled` and `unavailable`. A configured service starts pending. An observed cycle reports service readiness; blocked or uncertain cycles report `supervision_attention_required`; cycle exceptions report `supervision_cycle_failed`. These observations describe runtime operation, not accepted task completion or delivered user results. Aggregate health remains starting while supervision is pending and degraded when it is unavailable.

An idle or busy cycle without a fresh report preserves the preceding health observation. It cannot clear an unavailable state merely because no owner observation ran.

Health retains only bounded status and reason codes. It excludes task prose, prompts, source bodies, credentials, transport addresses and provider errors. Failure to persist runtime health resolves the service failure signal, causing Node shutdown with `supervision_runtime_failed`. An ordinary task or effect failure remains available for the existing bounded recovery loop. Transport health does not replace supervision health.

Configuration, startup, local failure handling, health aggregation and existing runtime regression tests cover this composition. Positive installed operation, reviewed activation, natural Discord intake and the complete acceptance journeys remain separate evidence requirements.
