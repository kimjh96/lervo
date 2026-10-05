# ADR-0455: Ratchet the platform-adapter boundary on neutral seams

Status: `accepted`
Decision date: 2026-10-04
Amends: [ADR-0417](0417-own-discord-visible-reference-product.md)
Part of: [ADR-0452 open collaboration platform](../../foundation/0452-open-collaboration-by-default-with-authority-at-consequential-effects.md)

## Context

ADR-0417 made Discord the installed reference surface while requiring it to remain a transport and presentation adapter. Domain and contract packages honour this: no file under `packages/agent-workforce`, `packages/agent-organization`, or `packages/conversation-*` mentions Discord; organization deployment events use an open `platform` string (`packages/schemas/src/organization-agent-event.ts:167-215`); and a neutral `ConversationAdapter.deliver` port exists (`packages/conversation-contract/src/outbound.ts:144-147`). The architecture check (`scripts/quality/check-package-boundaries.mjs`) reads only `package.json` dependencies, so it cannot detect concept leaks within an application.

Inside `apps/node-runtime/src`, the boundary has eroded:

- There are 46 `discord-*` files (6,311 lines), plus `supervision-discord-request-provenance.ts`. Another 40 non-test files mention Discord on 237 lines, led by `deployment-conversation.ts`, `config.ts`, `conversation-intent-resolver.ts`, and `conversation-platform-action-router.ts`.
- Every generic effect responder depends on `DiscordPlatformActionResponder` (`discord-conversation-mode-contract.ts:9`): `conversation-platform-action-router.ts`, `conversation-workforce-action-responder.ts`, `conversation-task-delegate-responder.ts`, `conversation-deliberation-action-responder.ts`, `conversation-discussion-action-responder.ts`, and `conversation-requested-runtime-responder.ts`. The router's fall-through parameter is named `discord`.
- Supervision request provenance is the closed union `source: "local" | "discord"` (`supervision-bound-request.ts:19,68-84,125`, `supervision-request-binding.ts:21`). Reply-versus-standalone publication uses `source === "discord"` (`supervision-native-publication.ts:68`).
- The intent kind registry, parser, prompt text, and validation hardcode `discord_current_member_nickname_set`, `discord_guild_text_channel_create`, and `discord_public_thread_create` (`conversation-intent-resolver.ts:12-27,74-88,186-197,248-302`).
- `ConversationWorkforceDeploymentPort` (`discord-hired-agent-deployment.ts:20-24`) has a generic name but returns `webhookId`; hire responses say a "Discord speaker" was prepared.
- Generic files duplicate the 2,000-character message limit under six names (`conversation-discussion-protocol.ts:8`, `conversation-result-publication.ts:21`, `conversation-repository-work-writing.ts:8`, `supervision-native-publication.ts:30`, `conversation-read-responder.ts:262,311`, `supervision-reasoning-run.ts:97`). The discussion protocol renders Discord mentions and throws "exceed Discord limits".
- `packages/schemas/src/surface-observability-report.ts:33` closes surface kind to `discord | first_party | local_cli | other`.

Two diagnoses in the brief were incorrect: `apps/conversation/src/built-in-integrations.ts` uses typed per-platform factories behind the open `ConversationIntegrationDeployment` extension point, not a hardcoded switch; the package-boundary script checks declared dependencies, not imports.

The owner has ruled out building a first-party platform now. This decision maintains the boundary as ADR-0453 and ADR-0454 add behaviour that must not deepen Discord coupling.

## Decision

### Scope

Maintain the boundary without extracting the Discord runtime from `apps/node-runtime`, renaming configuration keys, or building a first-party surface. Amend ADR-0417's platform-independence requirement from "the first-party surface must pass the shared suite when it ships" to "every new conversation or supervision behaviour must pass the shared suite through `@lervo/adapter-native-chat` before it is accepted on Discord".

### Neutral seams

Generic code depends on these seams in `@lervo/conversation-contract` or `@lervo/conversation-platform`; `@lervo/adapter-discord` implements them.

1. **Platform action port.** `ConversationPlatformActionPort` exposes `capabilities(): PlatformCapabilityDescriptor` and `perform(action: PlatformAction): Promise<PlatformActionReceipt>`. Actions are `self_name_set`, `channel_create`, `thread_create`, `message_pin`, and `reaction_add`. Unsupported actions fail with `platform_capability_unsupported` before any provider or network work. `DiscordPlatformActionResponder` becomes the Discord implementation and leaves `discord-conversation-mode-contract.ts`. The six generic responders and the router depend only on the port.
2. **Neutral platform effects.** Replace the three `discord_*` intent effects with `platform_self_name_set`, `platform_channel_create`, and `platform_thread_create`. The resolver receives the capability descriptor and offers only supported effects. Legacy kinds parse as aliases for one reader window, then are removed.
3. **Request provenance.** Replace `source` with `{ kind: "local" } | { kind: "conversation"; platform: string; integrationId: string }`. Dedupe keys use `conversation\0<platform>\0`; readers accept the legacy `discord\0` prefix during the window. Reply-versus-standalone publication uses `source.kind`.
4. **Speaker provisioning port.** `ConversationSpeakerProvisioningPort.prepare()` returns `{ platform, speakerPrincipalHash, deploymentRef }`. Webhook identifiers remain inside the Discord implementation and its configuration. Hire text says "speaker", not "Discord speaker", unless the adapter descriptor supplies a platform label.
5. **Adapter limits descriptor.** `ConversationAdapterDescriptor.limits` carries `maxMessageCharacters`, `maxMentions`, `supportsThreads`, `supportsReplies`, `supportsAgentMentions`, and `mentionSyntax`. Generic publication, discussion, and reasoning code reads the descriptor; delete the six constants. Oversize generic output fails with `platform_message_limit_exceeded`, carrying the limit and observed length.
6. **Open surface kind.** Make `surface-observability-report.kind` a bounded string (`^[a-z][a-z0-9_]{0,31}$`), document the four known values, and make readers tolerate unknown kinds.

ADR-0453 and ADR-0454 land only on these seams: principal-proxy decisions enter through typed application commands, multi-responder rooms use `ConversationAdapter` and the action port, and live agent mentions use the descriptor's `mentionSyntax`.

### Ratchet guard

Add `scripts/quality/check-platform-boundary.mjs` to `pnpm architecture:check`:

- Scan `apps/*/src` and `packages/*/src`, excluding `packages/adapter-discord`, `packages/discord-gateway`, tests, and files whose basename starts with `discord-`.
- For each remaining file, count lines matching `/discord/i` and imports of `./discord-*` modules.
- Track current per-file counts in `scripts/quality/platform-boundary-baseline.json`. Fail when a file exceeds its baseline count, a file absent from the baseline contains the term, or a `conversation-*` or `supervision-*` file imports a `discord-*` module it did not import at baseline.
- `pnpm architecture:baseline` rewrites counts only downward. Raising a count requires a manual baseline edit in a reviewed change naming the reason.
- Run the same scan for `slack` with its own baseline: the rule governs adapters, not one vendor.

Unit tests inject a leak into a fixture tree and assert failure, and lower a count and assert that baseline refresh accepts it.

### Shared acceptance suite

`packages/conversation-contract/test/platform-conformance/` holds scenarios driving implementations of `ConversationAdapter`, `ConversationPlatformActionPort`, and `ConversationSpeakerProvisioningPort` through hire, delegate, reply-with-mention, multi-responder, principal-proxy decision, and handoff notice. `adapter-discord`, `adapter-slack`, and `adapter-native-chat` run the suite. The native-chat run supplies the non-Discord test surface already required by ADR-0417 and the multi-party roadmap.

## Failure, state, and privacy

No canonical event changes. Add bounded failure codes:

- `platform_capability_unsupported`: the adapter descriptor lacks the requested action; nothing was attempted.
- `platform_message_limit_exceeded`: generic output exceeded the descriptor limit; nothing was sent.

Descriptors contain only adapter identity, build, and limits: no credentials, native identifiers, or message content. The baseline contains repository-relative paths and counts.

## Migration

1. Add the seams and native-chat implementations; keep Discord behaviour byte-identical behind them.
2. Land the ratchet with current counts as baseline. From then on, the count can only fall.
3. Move the three effect kinds, provenance union, and speaker port in one reader-first release; switch writers after the reader window.
4. Delete duplicated limit constants once every generic site reads the descriptor.
5. Lower the baseline as `discord-*` composition files absorb leaked concerns.

## Acceptance

- The ratchet passes on the baseline and fails on an injected leak in CI.
- The conformance suite passes for all three adapters.
- On the installed guild, hire, delegate, nickname change, and thread creation use neutral effect kinds with identical user-visible behaviour; completion events show the new `source.kind` on supervision requests.
- A grep for `MAXIMUM_DISCORD` outside `packages/adapter-discord` returns nothing.

## Deferred

Runtime extraction of `discord-*` files into a separate package or application, configuration key renames (`discordConversations`), native-chat installed parity, and any first-party surface remain outside this decision.

## References

- [ADR-0417](0417-own-discord-visible-reference-product.md)
- [ADR-0391](../../coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md)
- [Product surfaces](../../../specifications/execution/product-surfaces.md)
- [Host boundary roadmap](../../../roadmap/product-outcome-convergence/host-products/host-boundary.md)
