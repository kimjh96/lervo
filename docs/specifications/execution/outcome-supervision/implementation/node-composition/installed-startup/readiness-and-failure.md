# Readiness and failure meaning

The optional `supervision` component in the owner-only Node health snapshot uses `pending`, `ready`, `dormant`, `attention`, `disabled`, and `unavailable`. A configured service starts pending.

## Cycle observations

- Blocked or uncertain cycles report `supervision_attention_required` with the cycle's bounded attention `reasonCodes`: at most 16 identifier codes, such as `readiness_tools_failed` or `responsibility_lease_unresolved`.
- Cycle exceptions report `supervision_cycle_failed` with one bounded `reasonCodes` entry derived from the error's code or class name. Non-dormant cycle failures also invoke the service logger with the diagnostic format defined below; diagnostic text is separate from health.
- An unchanged idle or blocked cycle rereads the current source and authority before using its cursor. After a transient cycle exception or invalid `evidence_unavailable` report, a successful read restores the last valid evaluated health for the same binding; before the first valid report, health remains `pending`. Other blocked reports retain attention. A busy cycle does not clear failure health; a lineage rebind discards the prior binding's health. Recovery changes only the health projection and emits no new event.
- `supervision_workstream_inactive` reports `dormant` with required `reasonCode: workstream_inactive` when no exact canonical workstream or exact bound request origin is available for the reviewed binding. Once [bound-workstream supervision](../../../../../../decisions/execution/orchestration/governed-work/workstream-concurrency/0423-parallel-bound-workstreams.md) is installed, selection of another workstream in `current.json` alone is insufficient cause. The owner performs no supervised work while dormant. This is not a failed cycle and emits no failure log. A later exact request binding or eligible lineage binding returns the component to pending; a successful cycle returns it to ready. Other authority, source, or execution errors remain unavailable.
- A V3 goal whose next exact token reservation no longer fits reports `attention` with required `reasonCode: goal_budget_insufficient` and exact `resourceBudget` counters. It starts no new supervised effect; conversation, synchronization, remote control, and the Node process remain operationally ready. Legacy workstream-wide mandates remain unavailable with `aggregate_budget_exceeded` and must not be mislabeled as goal-scoped.
- A V3 mandate with reviewed `aggregateTokenPolicy.mode: per_attempt_only` never reports a cumulative budget state. Historical aggregate usage is not an admission boundary. Exact attempt, retry, concurrency, capacity, deadline, expiry, provider, role, capability, and path checks remain mandatory.
- Publication is required only when the verified bound request or trusted result configuration supplies an origin. Installing a conversation adapter alone does not require publication. A completed local goal with `accepted_local_result_available` and no next action reports `dormant` with required `reasonCode: local_result_canonical`; its accepted result remains canonical in the repository. Malformed or missing canonical request evidence still fails closed. This rule does not claim delivery.
- An effect that failed after invocation reports `effect_outcome_uncertain` plus the adapter's bounded failure code, if present. The managed worker boundary distinguishes `managed_output_bound_exceeded`, `managed_revalidation_failed`, `managed_deadline_elapsed`, `managed_cancelled`, `managed_stdin_failed`, `managed_launch_failed`, `managed_process_failed`, `managed_dispatch_evidence_missing`, and `managed_outcome_unreconciled`. None includes child output.

## Aggregate health and observation timing

These observations describe runtime operation, not accepted task completion or delivered user results. Aggregate health remains starting while supervision is pending and degraded when it is unavailable. Dormant or goal-budget-attention supervision does not hold an otherwise operational Node in starting: aggregate health can be ready, but the explicit supervision component remains visible and must never be presented as an active supervised goal. Fleet status exposes both conversation and supervision components so aggregate health cannot conceal this distinction.

A previously bound active goal receives at most sixty seconds of startup grace, with an explicit timer wakeup even without a new source event. Unfinished leased duties and pending decisions retain immediate continuation. Before evaluation, grace-period idleness reports pending.

An idle or busy cycle without a fresh report preserves the preceding health observation. Absence of an owner observation cannot clear an unavailable state.

## Bounded health and failure handling

Health retains only bounded status, failure, and reason codes. Dormancy is a replaceable health projection, not a new durable event. Its required reason is a fixed identifier carrying no workstream or agent ID. Health excludes task prose, prompts, source bodies, credentials, transport addresses, and provider errors.

Failure to persist runtime health resolves the service failure signal, causing Node shutdown with `supervision_runtime_failed`. Ordinary task or effect failure remains available for the existing bounded recovery loop. Transport health does not replace supervision health.

## Service diagnostics and recovery evidence

The shared `openNodeSupervisionService` composition uses an optional synchronous `log(line)` callback and otherwise writes diagnostics to the process error stream. It wires recovery-evidence read failures and uncertain-effect failures to the same logger used for non-dormant cycle failures. Lineage-follow errors also use the cycle-failure formatter. These diagnostics are separate from health fields and canonical attention codes; their occurrence or successful formatting does not prove recovery, effect completion, or delivery. The [local supervision command](local-command.md) shares this service composition.

Within `openNodeOutcomeSupervisionRuntime.readSnapshot`, the recovery-authority try block reads recovery authority, checks workstream revision and causal coordinates, and constructs the combined source binding. A coordinate mismatch returns conflicting evidence. An exception in that try block invokes optional `reportEvidenceReadFailure(error)` and then returns the existing snapshot with `authorityStatus: unobserved` and `evidenceStatus: unavailable`. Earlier snapshot and mandate reads are outside this catch. The callback is invoked synchronously without a protective catch; if it throws, the unavailable-snapshot return is not reached. It is not an isolated or guaranteed non-failing telemetry boundary.

Diagnostic formatting retains the outer error message and follows at most three non-null causes. Error causes contribute their names and messages; other values are converted to strings. The combined message uses ` <- ` separators, replaces runs of carriage returns, newlines, and NUL characters with spaces, and is sliced to 200 characters for cycle and recovery-evidence diagnostics or 400 for uncertain effects. These are JavaScript string-length limits on the combined message, not byte limits or whole-line limits. The outer error name, fixed prefix, code suffix, effect coordinates, and optional bundle coordinate are outside that slice.

A top-level code is accepted only when it matches `^[a-z][a-z0-9_]{0,63}$`. Cycle and evidence diagnostic prefixes otherwise derive a code from the Error name by removing a trailing `Error`, separating lower-case-or-digit to upper-case transitions, and lowercasing; invalid or empty results use `cycle_error_unclassified`. A valid original code is also appended in square brackets to the formatted detail. Uncertain-effect prefixes name the plan's action kind and effect contract.

Cycle diagnostics may append `origin=bin.js:<line>:<column>` extracted from the first stack frame. The extraction omits the stack frame's host path; it does not redact paths elsewhere in an error. Evidence-read and effect formatters do not append this stack coordinate.

The formatter performs no general redaction of messages or causes. Paths, credentials, prompts, task prose, provider errors, and configuration content can remain if an upstream error contains them. Error names are also outside the message truncation and normalization. The health privacy guarantee therefore does not extend to arbitrary diagnostic text. Diagnostic output must not be described as codes-only or as automatically excluding these contents.

## Validation boundaries

Configuration, startup, local failure handling, health aggregation, and existing runtime regression tests cover this composition. Positive installed operation, reviewed activation, natural Discord intake, and complete acceptance journeys remain separate evidence requirements.

The supplied health-test definitions assert goal-budget versus legacy-budget health, typed inactive-workstream handling, bounded reason codes, newline normalization, bundle-coordinate extraction, recovery-evidence diagnostic formatting, and wrapped effect causes. The startup-recovery test mocks the runtime and drives its hooks to check pending health, busy-cycle retention, idle recovery, and persistent ordinary attention. These definitions do not establish a passing test run, general diagnostic redaction, successful installed authority reads, or installed acceptance.

[Bound-workstream selection and evidence](readiness-and-failure/bound-workstream-selection.md) defines snapshot verification and the limits of local test evidence.
