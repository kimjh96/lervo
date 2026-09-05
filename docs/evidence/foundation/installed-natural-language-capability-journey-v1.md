# Installed natural-language capability journey v1

Status: `passed`

Observed: 2026-09-05

## Conclusion

The packed `@lervo/cli` 0.11.4 artifact completed an installed journey for a generated portable-skill candidate. Two independent managed runs produced distinct passed verification evidence. The installed CLI accepted a candidate, rejected promotion after a bound source changed, created a current replacement, recorded exact supersession, promoted its instructions, resource, skill manifest, and capability manifest, separately authorized only trust and current-project scope, and migrated its exact dependency graph.

An ordinary natural-language task produced a deterministic recommendation; the caller's exact `--capability` coordinate remained authoritative. The skill's MCP dependency was provider-confirmed before its instructions entered the task turn. The result passed publication and repository verification; `skill.completed` and `run.completed` referenced the same result digest.

Passing witness: `run_e10904ae65134122bc7619168ec8dff6`. Each regression creates a fresh temporary consumer and run; this identifier records the observation, not a stable fixture coordinate.

## Installed protocol

1. Pack the production CLI tarball and install it into an empty consumer without workspace-private runtime packages.
2. Initialize a separate local repository and activate event schema v2 through the installed CLI's evidence-bound plan/apply flow.
3. Install an MCP dependency by content-bound plan/apply. Run two independent managed repository verifications and retain their distinct event, run, suite, repository-revision, and result-content hashes.
4. Propose a portable-skill pattern from both source and verification groups and accept its exact candidate hash. Change one bound source and require promotion to report `source_snapshot_changed`. Propose a current replacement for the same target responsibility, supersede the stale reviewed candidate by its exact replacement pattern ID, and review the replacement.
5. Promote `SKILL.md`, one resource, `lervo-skill.json`, and `lervo-capability.json` as one plan. Separately authorize the skill's trust and current-project scope.
6. Migrate the promoted package, preserving the MCP dependency's exact ID, version, and content hash. Submit `Use the packaged repository testing workflow` with the exact generated capability coordinate. Deterministic discovery records the matching recommendation; explicit selection remains authoritative.
7. Use the production Codex adapter with a deterministic app-server protocol fixture. The fixture confirms the configured MCP server, records the task prompt outside the managed repository snapshot, completes the authorized file change, and returns a bounded result. A second isolated adapter session returns the exact writing-policy evaluation shape.
8. Inspect the installed run outcome, target bytes, recorded task prompt, and full trace before deleting the temporary consumer.

## Observed evidence

| Boundary | Exact observation |
| --- | --- |
| Candidacy | Two independent `verification.completed` events and runs were bound to current source units before candidate acceptance. |
| Stale source | Promotion after a bound workflow changed returned `blocked` with `source_snapshot_changed`; no target file was created. |
| Supersession | The stale reviewed pattern transitioned directly to `superseded`, retaining the distinct current replacement pattern ID for the same target kind and path. |
| Promotion and authorization | Exact-hash review promoted four package files. A separate saved plan changed only `untrusted -> reviewed` and `disabled -> current project`; the content hash remained unchanged. |
| Transaction rollback | Focused failure injection made event finalization fail after staging the four-file package; all four files were absent afterward. A conflicting maintainer-owned target remained byte-identical and blocked apply. |
| Migration | `capability migrate` preserved the generated capability ID, discovery metadata, permissions, and exact MCP dependency coordinates. |
| Recommendation | `capability.recommended` named the reviewed skill content hash and recorded `identity_token`, `intent_phrase`, and `keyword` reasons against the request digest. |
| Selection | `capability.selected` recorded `explicit` for the skill and `dependency` for the MCP package. The matching recommendation did not overwrite explicit authority. |
| Loading | `capability.loaded` recorded independent validation digests for both immutable installed packages. |
| Context delivery | The production adapter injected the required repository instruction and accepted the exact managed turn. The external prompt observation contained the complete `SKILL.md` text and its content hash. |
| Activation | `capability.activated` recorded `mcp_connected` for the exact dependency and provider session before `skill.invoked`. No activation event was invented for the skill itself. |
| Invocation | `skill.resolved` retained `trustStatus: reviewed`; `skill.invoked` bound the skill version to the request digest. |
| Output | The provider result passed the installed writing-policy evaluator, the only declared target contained the expected bytes, and the functional verification suite passed. |
| Completion | `skill.completed.outputDigest` and `run.completed.resultDigest` equaled the stored result artifact hash; `run.completed.verificationStatus` was `passed`. |

## Claim boundary

The deterministic provider fixture proves packed installation, verification-bound candidacy, stale-source rejection, exact replacement supersession, exact review, atomic multi-file promotion, project authorization, dependency-preserving migration, recommendation and authority precedence, provider-adapter configuration and receipt validation, exact instruction construction, managed-write enforcement, result storage, verification, and event ordering. Focused repository-knowledge tests separately prove transaction rollback and conflicting-byte preservation.

It does not prove live Codex model quality, provider service availability, model attention, understanding, semantic reliance, tool usefulness, automatic replacement or revocation of already promoted packages, or post-promotion effect attribution. `skill.invoked` and `skill.completed` remain orchestration evidence only. Repository retrieval did not create or authorize the candidate; supersession changed lifecycle evidence only.

## Regression

- `pnpm exec vitest run apps/cli/test/managed-run.test.ts apps/cli/test/capability-command.test.ts`
- `pnpm smoke:packed-cli`
- `apps/cli/test/managed-run.test.ts`
- `scripts/distribution/lib/installed-capability-journey.mjs`
- `scripts/distribution/lib/installed-portable-skill-candidate.mjs`
- `scripts/distribution/fixtures/installed-capability-codex.mjs`

## References

- [Capability package supply chain](../../specifications/execution/capabilities.md)
- [Natural-language capability lifecycle](../../decisions/execution/orchestration/0212-natural-language-capability-lifecycle.md)
- [Provider-confirmed capability activation](../../decisions/execution/providers/0211-provider-confirmed-capability-activation.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
