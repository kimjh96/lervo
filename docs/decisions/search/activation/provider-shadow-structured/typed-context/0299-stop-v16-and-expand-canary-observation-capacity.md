# ADR-0299: Stop v16 and expand canary observation capacity

Status: `accepted`
Date: 2026-08-30

## Context

Managed canary v16 verified the canonical E4 measurement projection and completed 11 scheduled provider turns. Its twelfth Codex turn completed, but persistence failed with `observation_limit_exceeded` because the isolated source repository already contained the hard maximum of 64 managed-canary records. The fail-first controller stored one bounded technical-failure observation and stopped.

V16 used 12 task calls, zero selection calls, zero API keys, zero retries, and made no repository writes. Eleven observations are valid accuracy samples, but the incomplete population cannot authorize activation. The 64 historical owner-only records occupy about 256 KiB and remain useful audit evidence.

## Decision

Preserve v16 as immutable terminal technical-failure evidence. Do not retry, repair, replace, resume, rescore, or complete its remaining schedule.

Raise `LINKED_EVIDENCE_MANAGED_CANARY_MAX_RECORDS` from 64 to 128 without deleting or overwriting historical observations. The explicit bound accommodates four additional 16-run populations from the observed baseline while preserving owner-only file permissions, schema validation, exact read-back, per-run uniqueness, locking, and fail-closed overflow behavior.

Prepare a fresh source- and build-bound v17 checkpoint with new run IDs for the unchanged population of eight Codex and eight Claude runs and the unchanged accuracy gates. Bind the v16 terminal manifest and observation-set digests, the 64-record baseline, and the 128-record capacity. Production activation remains conditional on a terminal passing v17 review.

## Consequences

Report the twelfth v16 provider call as failed experimental overhead, not a retry or accepted accuracy sample. Historical evidence remains intact. The increased limit adds bounded local derived-state capacity; it does not change canonical repository documents, provider authority, privacy classification, or runtime behavior outside managed canary recording.

## Verification

- Bind v16's prepared-manifest and terminal observation-set digests.
- Confirm 11 completed observations, one failed observation, 12 task calls, zero selection calls, and no repository writes.
- Confirm that the isolated repository contained exactly 64 valid records before the change.
- Test and build the 128-record limit while preserving fail-closed behavior.
- Prepare and review a fresh v17 manifest before any further provider call.

## References

- [Measurement projection stop](0298-stop-v15-on-measurement-projection-failure.md)
- [Claim reference eligibility](0297-separate-claim-reference-eligibility-from-task-evidence.md)
- [Managed canary specification](../../../../../specifications/execution/managed-linked-evidence-canary.md)
