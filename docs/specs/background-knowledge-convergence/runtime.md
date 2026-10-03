# Background convergence runtime

Status: `active`
As of: 2026-09-28

The runtime coordinates delegated background knowledge convergence, bounded execution, private evidence, and verified repository currency.

- [Ownership and activation](runtime/ownership-and-activation.md): runtime boundaries, source leases, delegation, and asset authority.
- [Discovery and bounded progress](runtime/discovery-and-progress.md): scheduling, stages, settlement, verification, and resource bounds.
- [Events, status, and privacy](runtime/events-and-status.md): canonical payloads, states, diagnostics, worker health, and provider probes.
- [CLI wrappers](runtime/cli-wrappers.md): inspection, delegation, probes, worker lifetime, and detached launch evidence.
- [Verification and remaining acceptance](runtime/verification-and-acceptance.md): execution-evidence coverage and production acceptance.

## References

- [ADR-0441: resident knowledge isolation](../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md)
- [ADR-0442: conversation repository snapshots](../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md)
- [ADR-0444: serialized knowledge materialization](../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md)
- [ADR-0438: bounded asset manifests](../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md)
- [ADR-0435: normalization after canonical rejection](../../decisions/knowledge/repository/canonicalization/0435-continue-normalization-after-canonical-rejection.md)
- [Recovery and retention contract](recovery-and-retention.md)
- [ADR-0436: reviewed source capture and bounded worksets](../../decisions/knowledge/repository/canonicalization/0436-reviewed-source-capture-and-bounded-canonical-worksets.md)
- [ADR-0437: streaming recent execution evidence](../../decisions/knowledge/repository/0437-stream-validated-recent-execution-evidence.md)
- [ADR-0440: complete execution-evidence pages](../../decisions/knowledge/repository/canonicalization/0440-page-complete-execution-evidence-for-canonicalization.md)
- [Implementation evidence](../../evidence/quality/background-knowledge-convergence-implementation.md)
- [Autonomous convergence roadmap](../../roadmap/knowledge/autonomous-background-convergence.md)
