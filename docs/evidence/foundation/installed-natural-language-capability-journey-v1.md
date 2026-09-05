# Installed natural-language capability journey v1

Status: `passed`

Observed: 2026-09-05

## Conclusion

The packed `@lervo/cli` 0.11.4 artifact completed an installed journey for an existing reviewed skill. An ordinary natural-language task produced a deterministic recommendation from verified discovery metadata; the caller's exact `--capability` coordinate remained the authoritative explicit selection. The skill's MCP dependency was resolved and provider-confirmed before its exact instructions entered the task turn. The result passed publication and repository verification, with `skill.completed` and `run.completed` bound to the same result digest.

Passing witness: `run_fac71592697047acac6aad69c41731bf`. Each regression creates a fresh temporary consumer and run; this identifier records the observation, not a stable fixture coordinate.

## Installed protocol

1. Pack the production CLI tarball and install it into an empty consumer without workspace-private runtime packages.
2. Initialize a separate local repository and activate event schema v2 through the installed CLI's evidence-bound plan/apply flow.
3. Install an MCP package and a project-scoped, pinned, `reviewed` skill package through separate content-bound `capability install` plan/apply operations. The skill declares the MCP dependency by exact ID, version, and content hash.
4. Submit `Use the packaged repository testing workflow` to `lervo run` with the exact reviewed-skill package coordinate. Deterministic discovery records the matching recommendation; explicit selection bypasses semantic capability grounding.
5. Use the production Codex adapter with a deterministic app-server protocol fixture. The fixture confirms the configured MCP server, records the task prompt outside the managed repository snapshot, completes the single authorized file change, and returns a bounded result. A second isolated adapter session returns the exact writing-policy evaluation shape.
6. Inspect the installed run outcome, target bytes, recorded task prompt, and full trace before deleting the temporary consumer.

## Observed evidence

| Boundary | Exact observation |
| --- | --- |
| Recommendation | `capability.recommended` named the reviewed skill content hash and recorded `identity_token`, `intent_phrase`, and `keyword` reasons against the request digest. |
| Selection | `capability.selected` recorded `explicit` for the skill and `dependency` for the MCP package. The matching recommendation did not overwrite explicit authority. |
| Loading | `capability.loaded` recorded independent validation digests for both immutable installed packages. |
| Context delivery | The production adapter injected the required repository instruction and accepted the exact managed turn. The external prompt observation contained the complete `SKILL.md` text and its content hash. |
| Activation | `capability.activated` recorded `mcp_connected` for the exact dependency and provider session before `skill.invoked`. No activation event was invented for the skill itself. |
| Invocation | `skill.resolved` retained `trustStatus: reviewed`; `skill.invoked` bound the skill version to the request digest. |
| Output | The provider result passed the installed writing-policy evaluator, the only declared target contained the expected bytes, and the functional verification suite passed. |
| Completion | `skill.completed.outputDigest` and `run.completed.resultDigest` equaled the stored result artifact hash; `run.completed.verificationStatus` was `passed`. |

## Claim boundary

The deterministic provider fixture proves packed installation, local capability installation, recommendation and authority precedence, provider-adapter configuration and receipt validation, exact instruction construction, managed-write enforcement, result storage, verification, and event ordering.

It does not prove live Codex model quality, provider service availability, model attention, understanding, semantic reliance, tool usefulness, or automatic skill generation. `skill.invoked` and `skill.completed` remain orchestration evidence only.

The existing reviewed skill was authored as fixture input. Repository retrieval did not create, modify, or authorize it.

## Regression

- `pnpm exec vitest run apps/cli/test/managed-run.test.ts apps/cli/test/capability-command.test.ts`
- `pnpm smoke:packed-cli`
- `apps/cli/test/managed-run.test.ts`
- `scripts/distribution/lib/installed-capability-journey.mjs`
- `scripts/distribution/fixtures/installed-capability-codex.mjs`

## References

- [Capability package supply chain](../../specifications/execution/capabilities.md)
- [Natural-language capability lifecycle](../../decisions/execution/orchestration/0212-natural-language-capability-lifecycle.md)
- [Provider-confirmed capability activation](../../decisions/execution/providers/0211-provider-confirmed-capability-activation.md)
- [Product outcome convergence](../../roadmap/product-outcome-convergence.md)
