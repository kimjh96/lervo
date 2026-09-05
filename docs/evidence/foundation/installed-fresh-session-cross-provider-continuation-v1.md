# Installed fresh-session cross-provider continuation v1

Status: `passed`

## Current objective

Verify that the packed `@lervo/cli` 0.11.4 artifact continues one bounded repository workstream from Codex into a fresh Claude run using canonical repository and event evidence. Both provider sessions are disposable; neither conversation is resumed.

## Resume procedure

Follow the [installed protocol and regression checks](installed-fresh-session-cross-provider-continuation-v1/evidence.md) to reproduce the observation in a fresh temporary consumer. Preserve one workstream identity across two revisions, reject a tampered projection before Claude starts, restore the exact recorded revision, and verify both changes and completion evidence.

## References

- [Observed evidence and claim boundary](installed-fresh-session-cross-provider-continuation-v1/evidence.md)
- [Execution and evidence specification](../../specifications/execution.md)
- [Structured workstream continuation state](../../decisions/knowledge/repository/0199-structured-workstream-continuation-state.md)
- [Provider adapter specification](../../specifications/execution/provider-adapters.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
