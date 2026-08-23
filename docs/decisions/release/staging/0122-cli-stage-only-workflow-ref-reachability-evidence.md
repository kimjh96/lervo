# ADR-0122: Stage-Only Workflow Ref-Reachability Evidence

- Status: accepted
- Decision date: 2026-08-21

## Context

ADR-0121 proves exact workflow bytes at a source commit, but not that the commit is on the default branch or addressed by the release tag. Branches and tags can move during observation, and annotated tags require bounded dereferencing. Reachability still does not prove execution, staging, approval, or publication.

## Decision

The read-only workflow-reachability command requires repository, exact 40-character lowercase source SHA, exact vMAJOR.MINOR.PATCH tag, absolute remote-evidence report, --online, and optional --json.

It snapshots canonical remote evidence up to 64 KiB and the current CLI manifest up to 1 MiB, validates the upstream report and exact target, and requires the current @lervo/cli identity, repository, license, and public registry. It reads apps/cli/package.json at the exact source commit, requires byte equality with the local canonical manifest, and binds the tag to v plus that version. Sources are rechecked after observation. It consumes remote workflow evidence without rereading the workflow or activation transaction.

Authenticated gh api GET calls read, in order, repository metadata, the source package, default-branch head, release-tag ref, up to five annotated-tag objects, and an exact source-to-head comparison; repository, branch, and tag refs are then re-read. Names and SHA values are strictly bounded. Tag messages, taggers, signatures, and user metadata are discarded.

Success requires the source commit to equal or precede default head and the fully dereferenced tag to equal the source commit. Any ref movement returns references_changed.

Evidence v1 binds evidence_bound, first_publication_stage_only_workflow_ref_reachability, exact target, upstream evidence and workflow digests, source-package path/blob/size/hash, observation time, default-head ancestry, tag kind/depth/commit, and ref rechecks. It stores no package body.

source_on_default_branch_and_exact_release_tag describes only that observation lifecycle. It does not authenticate upstream issuance, guarantee later branch stability or tag immutability/protection, or observe execution, staging, approval, or publication. Files and settings are unchanged; references are observed-not-changed; dispatch and publication are not attempted; output is stdout only.

Failures distinguish arguments, online/input/source/binding, not-ready refs, invalid normalized observation/report, and source races. Adapter reasons are authentication_or_references_unavailable, response_invalid, and references_changed. Output omits paths, digests, identities, credentials, and raw responses.

## Consequences

GitHub observation, tag resolution, source reading, pure evidence, standalone validation, orchestration, and formatting remain separate. Fixtures cover lightweight and nested annotated tags, ancestry/equality, wrong tags, non-ancestry, ref movement, depth limits, read-only behavior, forged upstream authority, races, and CLI separation.
