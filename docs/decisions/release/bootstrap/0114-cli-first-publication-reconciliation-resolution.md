# ADR-0114: Resolve Reconciled CLI First-Publication Outcomes

- Status: `accepted`
- Decision date: 2026-08-21

> Extended by [ADR-0115](0115-cli-first-publication-transition-evidence-union.md), which consumes this resolution as a distinct evidence member under the same stage-only completion policy as a normal execution receipt.

## Context

An ADR-0113 reconciliation report with `published` proves only that public npm exposed the exact artifact and dist-tag. It does not recover the original publisher receipt, 2FA proof, or execution receipt, and the immutable terminal remains `publication_unknown`. Recomputing a report digest must not convert that record into execution success.

Operators still need a safe path from a reviewed exact report to later stage-only transition review while public state continues to match. This path must establish review eligibility without reconstructing execution success.

## Decision

A dedicated serialized-reconciliation-report reader validates schema, canonical digest, target, bindings, side effects, limits, and only policy-producible check combinations. It compares the report with the current publication authorization, bootstrap, arming authorization, reservation v2, and unknown terminal. Validation alone establishes no new external fact and grants no `published` authority.

Human-authored resolution decision v1 contains:

- a `res_` decision ID and `authorize_reconciled_publication_transition_review`;
- decision and expiry times and a `{ kind: "user", id }` actor;
- exact package/version and bootstrap, reservation, terminal-record, and reviewed-report digests;
- acknowledgement that the exact published report was reviewed;
- acknowledgement that public observation is neither the original publisher receipt nor recovered 2FA proof;
- a prohibition on changing the unknown terminal;
- a requirement for separate fresh evidence before a stage-only transition.

The decision may be created only after the reviewed report's observation, and the complete observation-to-expiry interval is at most ten minutes. The actor is a local human assertion, not proof of npm authority or 2FA, and is not copied into the resolution output.

The command accepts:

```text
pnpm release:bootstrap:resolve \
  --publication-authorization <absolute-path> \
  --bootstrap <absolute-path> \
  --arming-authorization <absolute-path> \
  --reservation-root <absolute-path> \
  --reconciliation-report <absolute-path> \
  --decision <absolute-path> \
  --output <new-absolute-path> \
  --online
```

The reviewed report and decision must be regular files no larger than 64 KiB, encoded as two-space-indented JSON with a final LF. After reading every source, including the storage snapshot, observe exact-version metadata and the public npm dist-tag again. Create a resolution only if the fresh report is also `published` and its observation follows the reviewed report. Recheck every source for mutation, then write only the new output using `wx` semantics.

Resolution v1 has `status=transition_review_eligible` and `resolutionType=reconciled_first_publication`. Its canonical digest binds:

- the exact target and bootstrap, arming, and publication authorizations;
- the reservation and unknown terminal record;
- the reviewed and fresh reconciliation reports;
- the decision ID and digest and the resolution time;
- eligibility only for transition review;
- no transition-completion authorization or recovered execution receipt;
- continuing prohibitions on retry and terminal mutation;
- fresh checks of the exact public release, stage-only workflow, npm trust, and GitHub environment;
- unchanged reservation, terminal, execution receipt, publication, and external settings.

Embed the fresh report so later readers can independently validate its schema, outcome, observation time, and digest. Keep the reviewed report as a distinct human-reviewed source whose digest is bound by both the decision and resolution.

The resolution is a different evidence type from an execution receipt and does not directly create `published_transition_pending`. A later transition must distinguish both types while applying the same freshly evaluated stage-only policy.

Errors exclude actors, document bodies, paths, credentials, raw registry responses, and unrelated digest or tag values. Add no runtime event, project state, or telemetry. `transition_review_eligible` exists only within this document.

## Consequences

A redigested report or stale decision cannot elevate an unknown execution into success. Later transition review requires both bounded human review and a fresh exact public observation, while the terminal and execution-evidence meanings remain unchanged.

Fixtures cover reviewed/fresh binding, report and decision mismatches, expiry, fresh absence, reversed timestamps, actor redaction, privilege-escalating redigests, canonical sources, source mutation, non-overwrite output, and unchanged reservation directories. They do not claim actual publication, 2FA, recovered execution receipts, transition completion, or external setting changes.
