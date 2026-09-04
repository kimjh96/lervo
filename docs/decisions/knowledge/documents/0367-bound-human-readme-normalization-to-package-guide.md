# ADR-0367: Bound human README normalization to the package-guide contract

Status: `accepted`  
Date: 2026-09-04

## Context

Reviewed document normalization allowed a 12 KiB `human_readme`, while the packed CLI contract limited its installed package guide to 4 KiB. A normalized 4,109-byte `apps/cli/README.md` passed candidate validation but failed after the packed consumer was built. Shortening it without changing the contract produced another 4,099-byte candidate and repeated the late failure.

The package check also required one exact English rendering of the Node.js minimum, although `Node.js 22.13+` and `Node.js 22.13 or later` are equivalent.

## Decision

Set the provider-neutral `human_readme` normalization maximum to 4 KiB. Keep the independently scoped `agent_instruction` maximum at 12 KiB. Publish the same maximum in the no-capability compiler envelope, and enforce it for fresh responses and stored candidates.

Keep the packed CLI check authoritative for installed guide sections and commands, but accept these bounded equivalent Node.js requirements: `22.13+`, `22.13 or later`, and `22.13 or newer`.

An oversized response fails with `knowledge_compile_failed` before candidate approval or application. This adds no event or durable state. Telemetry receives neither the document body nor provider output.

## Consequences

Package README normalization cannot create an artifact known to violate the shared short-entrypoint size contract. Other human README entrypoints receive the same conservative bound; agent instructions retain their separate budget. Packed verification still catches required-content, package-shape, and installed-consumer failures outside normalization's responsibility.

## Verification

- Repository-knowledge tests inspect the compiler envelope and reject package README responses above 4 KiB.
- Document normalization, knowledge lint, and the packed CLI consumer pass with the exact reviewed guide.
- Code-convention review keeps profile policy, provider invocation, CLI rendering, and release-consumer verification in separate modules.

## References

- [Reviewed document content normalization](../repository/0195-reviewed-document-content-normalization.md)
- [CLI package usage guide](../../release/packaging/0090-cli-package-usage-guide.md)
- [Document normalization evidence renewal](../../../roadmap/knowledge/document-normalization-renewal.md)
