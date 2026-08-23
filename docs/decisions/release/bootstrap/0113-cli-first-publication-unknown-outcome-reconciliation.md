# ADR-0113: Reconcile Unknown CLI First-Publication Outcomes

- Status: `accepted`
- Decision date: 2026-08-21

> Superseded in part by [ADR-0114](0114-cli-first-publication-reconciliation-resolution.md), which adds a separate resolution that rebinds a reviewed report to current source records and requires a fresh public observation plus a human decision.

> Extended by [ADR-0115](0115-cli-first-publication-transition-evidence-union.md), which makes reconciliation and transition use the same public-release policy.

## Context

A connection error, receipt mismatch, or failure to persist terminal completion after publisher invocation can leave publication success unknown. The execution core closes such attempts with a durable reservation, `publication_unknown`, and `retry=forbidden`. Treating this as failure risks duplicate publication; treating a visible package name as success could approve the wrong artifact or dist-tag.

Reconciliation must neither overwrite the terminal record nor issue another bootstrap. It must produce a read-only comparison between public npm facts and the exact release while preserving the observation's limitations.

## Decision

Accept only reservation v2 and a `publication_unknown`, `retry=forbidden` terminal. Revalidate the publication authorization, bootstrap, arming authorization, reservation, terminal coordinates, and their digests. Evaluate arming authorization at its issue time and reservation at its reservation time; current expiry does not invalidate historical evidence.

The anonymous public npm observer reads only:

- `dist.integrity` and `dist.shasum` from exact `@lervo/cli@<version>` metadata;
- the approved `latest|next` value from `@lervo/cli` dist-tags.

Limit each response to ten seconds and 256 KiB, and disable redirects. Do not retain raw bodies, unrelated version metadata or tags, or request-error details. Normalize observations to the two required values or `not_found|unavailable`.

The pure policy returns:

- `published` when exact-version integrity and shasum match the release and the target dist-tag points to that version;
- `not_observed` when exact-version metadata is absent and the target dist-tag does not point to that version;
- `unknown` for partial matches, digest mismatches, malformed responses, or registry unavailability.

`not_observed` neither proves non-publication nor authorizes retry. Registry propagation and observation limits remain possible, so `retry=forbidden` persists. `published` is not an original publisher receipt, 2FA proof, execution receipt, or completed stage-only transition.

Report v1 canonically binds the exact target; bootstrap, arming, and publication authorizations; reservation and terminal-record digests; observation time; version and dist-tag checks; and these limits:

- only the public registry was observed;
- private-package state was not observed;
- automatic retry is not authorized;
- the transition is incomplete.

Fix side effects as reservation and terminal `unchanged`, publication `not_attempted`, and external settings `not_changed`. Readers reconstruct the complete report from source records and normalized observations instead of trusting its digest alone.

The command is:

```text
pnpm release:bootstrap:reconcile \
  --publication-authorization <absolute-path> \
  --bootstrap <absolute-path> \
  --arming-authorization <absolute-path> \
  --reservation-root <absolute-path> \
  --online [--json]
```

Without the explicit online boundary, read no files. Check all three contract files and the stored snapshot before and after observation. Storage `inspect` must not create a missing root or reservation directory. A successful exit means only that a report was produced; print every outcome to stdout. Write no result file, prompt for nothing, and change no reservation, terminal, publication, retry, or external setting.

Errors exclude paths, credentials, raw registry responses, and unrelated digest or tag values. Add no runtime event, project state, or telemetry. The three outcomes exist only in reconciliation reports.

## Consequences

Operators can classify an uncertain first publication without risking a blind retry. Exact public visibility preserves the unknown terminal and leaves recovery authorization to a separate decision; public absence still does not permit automatic retry.

Fixtures cover exact publication, complete absence, partial matches, digest mismatch, registry failure, redigested outcome forgery, wrong terminals, source mutation during observation, non-creation of missing roots, and bounded responses. They do not claim actual npm publication, 2FA, private-package absence, or transition completion.
