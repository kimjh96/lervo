# ADR-0113: Reconcile Unknown CLI First-Publication Outcomes

- Status: `accepted`
- Decision date: 2026-08-21

> Superseded in part by [ADR-0114](0114-cli-first-publication-reconciliation-resolution.md), which adds a separate resolution that rebinds a reviewed report to current source records and requires a fresh public observation plus a human decision.

> Extended by [ADR-0115](0115-cli-first-publication-transition-evidence-union.md), which makes reconciliation and transition use the same public-release policy.

## Context

After invoking a publisher, a connection error, receipt mismatch, or failure to persist terminal completion can leave local state unable to determine whether publication succeeded. The execution core closes such attempts with a durable reservation, `publication_unknown`, and `retry=forbidden`. Treating that state as failure risks duplicate publication; treating a visible package name as success may approve the wrong artifact or dist-tag.

Reconciliation must not overwrite the terminal record or issue another bootstrap. It needs a read-only report that compares only facts observable from public npm with the exact release while retaining those facts' limits.

## Decision

Reconciliation accepts only a reservation v2 and a `publication_unknown`, `retry=forbidden` terminal. It revalidates publication authorization, bootstrap, arming authorization, reservation and terminal coordinates, and their digests. Arming authorization is evaluated at its issue time and the reservation at its reservation time; current expiry does not invalidate historical source evidence.

The anonymous public npm observer reads only:

- `dist.integrity` and `dist.shasum` from exact `@lervo/cli@<version>` metadata;
- the approved `latest|next` value from `@lervo/cli` dist-tags.

Each response is limited to ten seconds and 256 KiB, with redirects disabled. Raw bodies, other version metadata, other tags, and request-error details are not retained. Observations are normalized to the two required values or `not_found|unavailable`.

The pure policy returns:

- `published` when exact-version integrity and shasum match the release and the target dist-tag points to that version;
- `not_observed` when exact-version metadata is absent and the target dist-tag does not point to that version;
- `unknown` for partial matches, digest mismatches, malformed responses, or registry unavailability.

`not_observed` does not prove non-publication or authorize a retry. Registry propagation and observation limits remain possible, so the terminal's `retry=forbidden` stands. `published` is not the original publisher receipt, 2FA proof, or execution receipt and does not complete the stage-only transition.

Report v1 canonically binds the exact target; bootstrap, arming, and publication authorizations; reservation and terminal record digests; observation time; version and dist-tag checks; and these limits:

- only the public registry was observed;
- private-package state was not observed;
- automatic retry is not authorized;
- the transition is not complete.

Side effects are fixed to reservation and terminal `unchanged`, publication `not_attempted`, and external settings `not_changed`. Readers reconstruct the complete report from its source records and normalized observations rather than trusting its digest alone.

The command is:

```text
pnpm release:bootstrap:reconcile \
  --publication-authorization <absolute-path> \
  --bootstrap <absolute-path> \
  --arming-authorization <absolute-path> \
  --reservation-root <absolute-path> \
  --online [--json]
```

Without the explicit online boundary, it reads no files. The source reader checks all three contract files and the stored snapshot both before and after observation. Storage `inspect` does not create a missing root or reservation directory. A successful exit means only that a report was produced; every outcome is printed to stdout. The command writes no result file, prompts for nothing, and changes no reservation, terminal, publication, retry, or external setting.

Errors exclude paths, credentials, raw registry responses, and unrelated digest or tag values. This decision adds no runtime event, project state, or telemetry. The three outcomes exist only inside reconciliation reports.

## Consequences

Operators can classify an uncertain first-publication outcome without a blind retry. Seeing the exact public release preserves the original unknown terminal and leaves recovery authorization to a separate decision. Seeing nothing on public npm still does not enable an automatic retry.

Fixtures cover exact publication, complete absence, partial matches, digest mismatch, registry failure, redigested outcome forgery, wrong terminals, source mutation during observation, non-creation of missing roots, and bounded responses. They do not claim actual npm publication, 2FA, absence of a private package, or transition completion.
