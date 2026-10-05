# V0 milestones and acceptance

## Completed milestones

- M0: [Schemas, policy defaults, event privacy, and project initialization](../../decisions/foundation/0001-m0-contracts-and-data-defaults.md)
- M1: [Local event store, CAS, and storage composition](../../decisions/operations/storage/0003-local-event-store-and-cas.md)
- M2: [Deterministic context preparation and provider-neutral delivery](../../decisions/execution/providers/0007-provider-neutral-context-delivery.md)
- M3: [Managed adapters, write bridge, and verification](../../decisions/execution/providers/0011-managed-provider-run-lifecycle.md)
- M4: [Skills, document ownership, migration, writing, and deliberation](../../decisions/knowledge/documents/0018-existing-document-adoption.md)
- M5: [Search, knowledge lifecycle, diagnostics, trace, and optional Hub](../../decisions/search/0053-deterministic-lexical-search-observations.md)
- M6: [Signed remote commands and standalone runtimes](../../decisions/execution/providers/0153-managed-provider-node-host.md)
- K0–K5: [Repository knowledge compilation through dogfood](../../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)

## Repository-knowledge hardening

Completed on 2026-08-23. See [hardening capabilities and acceptance facts](repository-knowledge-hardening.md).

## V0 completion

V0 acceptance completed on 2026-08-24. Reviewed normalization passed the complete Shiflo `migrate knowledge --provider -> review -> apply -> refresh -> lint -> current` cycle and equivalent Lervo self-migration. Root and package READMEs document source-checkout installation without npm publication. See [normalization acceptance evidence](../../evidence/pilots/reviewed-document-normalization.md).

The authoritative 2026-08-23 language audit found zero runtime, fixture, or documentation files and lines requiring remediation. The English npm description, release manifest, and SBOM were regenerated and verified locally; no package was published. This was repository work, not a hosted semantic-product request.

## Installed follow-up acceptance

The 2026-08-25 live gap is closed. Exact evidence and non-claims are tracked in [Repository Node fleet and automatic Hub replication](../coordination/repository-node-fleet.md).

## Acceptance gates

See the completed, independently maintained [Lervo v0 acceptance gates](../v0-acceptance-gates.md).
