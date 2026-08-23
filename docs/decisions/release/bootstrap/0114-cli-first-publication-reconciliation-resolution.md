# ADR-0114: Resolve Reconciled CLI First-Publication Outcomes

- Status: `accepted`
- Decision date: 2026-08-21

> Extended by [ADR-0115](0115-cli-first-publication-transition-evidence-union.md), which consumes this resolution as a distinct evidence member under the same stage-only completion policy as a normal execution receipt.

## Context

An ADR-0113 reconciliation report with `published` proves only that public npm exposed the exact artifact and dist-tag. It does not recover the original publisher receipt, 2FA proof, or execution receipt, and the immutable terminal remains `publication_unknown`. Recomputing a report digest must not convert that record into execution success.

Operators nevertheless need a safe path from a reviewed exact report to later stage-only transition review when public state continues to match. That path must express review eligibility without reconstructing execution success.

## Decision

A dedicated serialized-reconciliation-report reader validates schema, canonical digest, target, bindings, side effects, limits, and only check combinations the policy can produce. It also compares the report with current publication authorization, bootstrap, arming authorization, reservation v2, and unknown terminal. Validation alone proves no new external fact and grants no `published` authority.

A human-authored resolution decision v1 contains:

- a `res_` decision ID and `authorize_reconciled_publication_transition_review`;
- decision and expiry times plus a `{ kind: "user", id }` actor;
- exact package and version plus bootstrap, reservation, terminal-record, and reviewed-report digests;
- acknowledgement that the exact published report was reviewed;
- acknowledgement that public observation is not the original publisher receipt and does not recover 2FA proof;
- a prohibition on changing the unknown terminal;
- a requirement for separate fresh evidence before a stage-only transition.

The decision may be created only after the reviewed report's observation, and the full interval from observation to expiry is at most ten minutes. The actor is a local human assertion, not proof of npm authority or 2FA, and is not copied into the resolution output.

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

The reviewed report and decision must be regular files no larger than 64 KiB, encoded as two-space-indented JSON with a final LF. After reading every source, including the storage snapshot, the command observes exact-version metadata and the dist-tag on public npm again. It creates a resolution only when the fresh report is also `published` and was observed after the reviewed report. It then rechecks every source for mutation and writes only the new output with `wx` semantics.

Resolution v1 uses `status=transition_review_eligible` and `resolutionType=reconciled_first_publication`. Its canonical digest binds:

- the exact target and bootstrap, arming, and publication authorizations;
- the reservation and unknown terminal record;
- the reviewed and fresh reconciliation reports;
- the decision ID and digest plus resolution time;
- eligibility for transition review only;
- no transition-completion authorization or recovered execution receipt;
- retry and terminal mutation remaining forbidden;
- requirements for fresh checks of the exact public release, stage-only workflow, npm trust, and GitHub environment;
- unchanged reservation, terminal, execution receipt, publication, and external settings.

The fresh report is embedded so later readers can independently validate its schema, outcome, observation time, and digest. The reviewed report remains a distinct human-reviewed source document whose digest is bound by both the decision and resolution.

The resolution is evidence of a different type from an execution receipt and does not directly create `published_transition_pending`. A later transition must distinguish the two types while applying the same freshly evaluated stage-only policy.

Errors exclude actors, document bodies, paths, credentials, raw registry responses, and unrelated digest or tag values. This decision adds no runtime event, project state, or telemetry. `transition_review_eligible` exists only inside this document.

## Consequences

A redigested report or stale human decision cannot elevate an unknown execution into success. Both bounded human review and a fresh exact public observation are required before later transition review, while the original terminal and execution-evidence meanings remain intact.

Fixtures cover reviewed/fresh binding, report and decision mismatch, expiry, fresh absence, reversed timestamps, actor redaction, privilege-escalating redigests, canonical sources, source mutation, non-overwrite output, and unchanged reservation directories. They do not claim actual publication, 2FA, recovered execution receipts, transition completion, or external setting changes.
