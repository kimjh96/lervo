# ADR-0123: Stage-Only Workflow Execution Evidence

- Status: accepted
- Decision date: 2026-08-21

## Context

Reachable workflow source is not execution proof. GitHub reruns create attempts under one run ID, so an older success can conceal a later attempt. Partial job or artifact pages and cross-attempt artifacts are unsafe. GitHub success must not be elevated into independent npm acceptance.

## Decision

The read-only `workflow-execution` command requires the exact repository, source SHA, release tag, positive safe-integer run ID and attempt, absolute reachability report, `--online`, and optional `--json`. The operator must select both run coordinates; this grants no execution authority.

The command validates a canonical reachability report up to 64 KiB, requires exact target equality, and rechecks source bytes after observation.

Authenticated `gh api GET` reads fixed workflow metadata, the current run, exact attempt, one job page, one exact-name artifact page, and then the current run again. Responses are limited to 2 MiB. Pages use `per_page=100&page=1` and are accepted only when `total_count` is at most 100 and equals the returned length.

Workflow ID, path, and active state must match. Current and exact-attempt normalized runs must agree. The run must be `workflow_dispatch` on the exact tag and source SHA. A new attempt or other mutation yields `run_changed`.

Only the `Stage CLI publication` job and its `Stage exact CLI package` and `Upload stage publication result` steps are retained; identities, runners, labels, and raw responses are discarded. The run, job, and both steps must be completed successfully.

Exactly one nonexpired artifact named `lervo-cli-stage-<release-tag>-<attempt>` must be between 1 byte and 64 MiB, have a SHA-256 digest, and match the run ID and source SHA. Its contents are not downloaded here.

Report v1 binds `evidence_bound`, `first_publication_stage_only_workflow_execution`, target/run coordinates, upstream and workflow digests, normalized workflow/run/job/steps/artifact, observation time, and run recheck. `exact_attempt_completed_success_with_stage_result_artifact` means only GitHub success plus artifact metadata. It does not authenticate upstream issuance, prevent later reruns, verify artifact contents, or observe npm staging, 2FA, or publication.

Files and settings remain unchanged; dispatch, rerun, download, and publication are not attempted; output is stdout only. Failures distinguish arguments, online/input/source/binding, not-ready execution, invalid observation/report, and source races. Adapter reasons are `authentication_or_execution_unavailable`, `response_invalid`, `run_or_attempt_mismatch`, `result_set_invalid`, and `run_changed`. Sensitive metadata and raw responses are omitted.

## Consequences

Fixtures cover exact success, historical attempts, concurrent reruns, failed steps, duplicate artifacts, pagination bounds, races, forged upstream evidence, non-mutation, and metadata disposal.
