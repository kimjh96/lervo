# Installed bounded unattended scheduler v1

Status: `passed`

Observed: 2026-09-07

## Claim

The packed `@lervo/cli` 0.12.0 artifact can be installed into an empty consumer, initialize a local repository, discover product-host protocol v5, and complete one queued assignment from one explicitly authorized bounded `lervo loop schedule` invocation without a Hub or another manual trigger.

## Installed scenario

`pnpm smoke:packed-cli` built the real tarball and installed only `@lervo/cli` into a temporary consumer. The fixture:

1. Initialized a minimal local repository and activated the compatible event writer.
2. Started one active workstream, hired one Codex-compatible developer agent, and created one queued assignment.
3. Installed a deterministic managed Codex process fixture and one exact verification suite.
4. Invoked `loop schedule` once with explicit write authority, one eligible agent, 100 ms polling, two cycles, one claim, one managed run, a 60-second admission runtime, and a five-minute lease.
5. Observed exactly one claim, one managed run, one verified completion, no retry, no recoverable race, and final `work_complete` status on cycle two.
6. Re-read canonical workforce state as `completed`, verified the declared repository file bytes, and verified that the provider received the assignment acceptance criterion.

The same packed check discovered protocol v5 with 27 routes: 10 workforce, 11 operating, and 6 collaboration. Protocol v5 omitted only `unattended_scheduling` from the earlier unsupported set; protocols v1 through v4 retained their prior shapes and limitation.

## Focused adverse boundaries

Separately executed source tests proved:

- Pure selection rejects stale assignment revisions, incompatible roles, capabilities, providers, responsibility paths, foreign leases, cancellation mutation, and automatic prepared-completion reconciliation.
- Workforce claim rechecks the exact selected revision under its existing atomic scheduler lock.
- Only the current scheduler session's lease can start a provider.
- An already-engaged repository kill switch prevents inspection and mutation.
- One owner-only repository scheduler lock rejects concurrent invocation and releases only exact ownership.
- Managed requests accept the assignment's complete expected-path set and reject ambiguous, empty, duplicate, oversized, or escaping path inputs.
- A recorded provider attempt without terminal proof is `uncertain`: neither retried nor finalized as failed.
- Existing governed token-dimension, cache, duration, attempt, approval, cancellation, verification, publication, and prepared-completion boundaries remain in the execution path.

## Evidence commands

```text
pnpm quality:check
pnpm exec vitest run packages/work-controller/test/unattended-scheduler-selection.test.ts packages/agent-workforce/test/workforce.test.ts apps/cli/test/managed-run-request.test.ts apps/cli/test/unattended-scheduler-options.test.ts apps/cli/test/unattended-scheduler-runtime.test.ts apps/cli/test/unattended-scheduler.test.ts apps/cli/test/loop-command.test.ts apps/cli/test/application-command.test.ts apps/cli/test/managed-run.test.ts
pnpm build
pnpm smoke:packed-cli
pnpm check
```

Observed results: 62 focused tests passed, all 96 buildable workspace projects built, and the final repository check passed all 527 test files and 2,662 tests. The installed scheduler assignment completed and the packed CLI consumer check passed. The release manifest, SBOM, unsigned statement, Hub and Node distributions, local registry publication preflight, documentation lifecycle, and brand checks were current.

## Limits

This evidence does not claim operating-system daemon installation, remote wakeup, in-flight provider preemption, provider-native session resume, implicit approval, automatic cancellation, automatic uncertain-completion reconciliation, dynamic topology, unmanaged whole-request accounting, or Hub availability. The scheduler result is a bounded process report; canonical proof remains in assignments, leases, events, verification, artifacts, and repository state.

## References

- [Bounded unattended assignment scheduling](../../specifications/execution/unattended-scheduling.md)
- [ADR-0379](../../decisions/execution/orchestration/governed-work/0379-install-bounded-unattended-assignment-scheduling.md)
- [Bounded autonomous continuation outcome](../../roadmap/product-outcome-convergence/execution/autonomous-continuation.md)
