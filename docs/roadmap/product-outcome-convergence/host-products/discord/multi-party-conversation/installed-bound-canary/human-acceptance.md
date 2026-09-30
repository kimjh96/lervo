# Human acceptance and routing corrections

## Pending human-authored route

The observed Shiflo organization has active product owner Ruen and active hired agents Nuri, Sora, and Dami. Installed `#shiflo` binds Ruen's application bot and the three hired agents' existing webhook speakers in one conversation. Shiflo conversation status was `ready` at `2026-09-19T13:33:09.064Z`. This is an observed test roster, not a role or routing constant.

A new human request to Ruen can ask for one read-only bounded check delegated to Nuri, followed by Nuri addressing Sora for independent review, with no approval, deployment, or file change. Check PO-to-hired and hired-to-hired messages against source identifiers, durable inbox, participation, outbox, focus, and observed channel publication. Controlled redelivery, failure, retry, and restart observations remain required to resolve review approval. A separate new human `@Elio` turn must demonstrate a standing successor while the selected review stays held. At this r31 checkpoint, neither human turn had been observed since rollout.

A later read-only credential check returned HTTP 200 for Ruen's existing application bot `1547405022587781260` and existing Sora, Nuri, and Dami webhooks `1547621764161343489`, `1547729649688125492`, and `1547729654620753940`. Every webhook reported configured `#shiflo` channel `1547263100846080312`. Repository workforce records retained all four active agents, their IDs, and parent relationships. No Discord message was sent, webhook created, or credential value recorded; this did not prove two-direction conversation.

Using those configurations and current workforce bindings, the installed co-resident resolver produced exact routes scoped to `cnv_shiflo_team`, guild `1546479354773508176`:

- Ruen to Nuri: `agt_aaf0193d83a4fe813084c448`, `webhook:1547729649688125492`.
- Nuri to Sora: `agt_cd8a9ebda2be92e898cf63ac`, `webhook:1547621764161343489`.
- Sora to Nuri return route.

This proves configuration-time addressability and durable recipient identity. A new human-authored installed turn must prove acceptance, execution, and publication of the chain.

## 2026-09-20 human-turn failure diagnosis

The human sent `#general` message `1550989252362244177` at `2026-09-19T21:57:33.750Z` and `#shiflo` message `1550989401021218889` at `2026-09-19T21:58:09.193Z`. Discord REST verified human authorship. Both native mentions were managed bot roles:

- Elio role `1547403445387141144`: `tags.bot_id: 1547393266193006632`.
- Ruen role `1547405367644782693`: `tags.bot_id: 1547405022587781260`.

r34 ignored `mention_roles`; both persisted inbound events therefore had empty participant and role mentions. Elio observed the general message; Tarin owned it as an unaddressed turn, selected repository work, and ended with generic `response_generation_failed`. Elio's standing successor was not exercised. This failed routing acceptance grants no permission to change the held review.

Ruen owned the Shiflo request and selected `workforce_task_delegate` for exact Nuri participant `ptc_agent_aaf0193d83a4fe813084c448`. The inbox ended after one attempt with `response_generation_failed`; Nuri's store has no delegated assignment from it. The receiver's configured Ruen peer retained role contract/profile hashes `8c255c...`/`d094f...`, while Ruen's current hired-agent binding used `201152...`/`a80a4f...`. Exact binding equality is required by the co-resident router, so the static peer snapshot could not authenticate Ruen after role migration. Only a generic private error coordinate survived, not the thrown stack. The binding mismatch is a source-backed explanation, not recovered historical exception text.

Source corrections verify a managed bot role against the authenticated guild role list before mapping it to the existing bot participant; unknown roles remain explicitly unresolved. Co-resident identity, ownership, and delegation use the active hired role revision for the exact agent while retaining configuration-scope checks.

Focused Discord adapter, conversation-platform, ownership, delegation, and peer-router tests passed 91/91 on Mac; the full Mac build passed. Source checks do not retroactively repair completed inbound attempts or constitute installed acceptance. The selected review stayed byte-identical at `sha256:07a46a15b427b9c2d6ac15e2102c50506916e742a5b548801f12142dd9cac2b5`, active revision 2 with approval `wapr_e4cd367a01b02a4f`. Diagnosis changed neither approval nor deployment.

## Managed-role and co-resident-binding correction rollout

Corrected Linux Node distribution `sha256:39d65869578ac283e006ed6945d7bb976ef80be513612f10e6001095a3f243b0` (`runtime-39d65869-r35`) was built, archive-verified, installed immutably, and preflighted against all seven existing configurations. Canary and Shiflo were upgraded first, then Plen, Flemo, Arca-next, Digimon, and AXLI. Each retained an exact owner-only predecessor service definition for rollback.

Immediately before AXLI upgrade, its original on-demand preview process no longer existed and port `4317` returned `ECONNREFUSED`; no live preview was interrupted. All seven user services were active on r35 with zero restarts and health process IDs matching systemd main PIDs. Elio, Shiflo, Plen, Flemo, Arca-next, and Digimon were overall and conversation `ready`. AXLI conversation, sync, workstream replication, and remote control were `ready`; supervision separately remained `degraded` with `aggregate_budget_exceeded`. AXLI supervision success is not claimed.

Installed Elio and Ruen bot credentials each returned HTTP 200 for the guild role list. Read-only parsing and managed-role resolution of the actual prior human messages mapped:

- Elio's role only to bot `1547393266193006632`, participant `ptc_lervoelio01`, agent `agt_3dd1b5bbabc943d145d5056b`.
- Ruen's role only to bot `1547405022587781260`, participant `ptc_shifloruen01`, agent `agt_993b64fe62e325b389b56a11`.

Active Nuri and Sora platform bindings now record Ruen's current hashes `201152...`/`a80a4f...`; their mutual webhook participant bindings remain distinct. The focused 91 tests passed on Mac and WSL. These checks neither replay completed inbound events nor prove a successful new human turn. The held WSL review remained byte-identical at `sha256:07a46a15b427b9c2d6ac15e2102c50506916e742a5b548801f12142dd9cac2b5`, active revision 2 with approval `wapr_e4cd367a01b02a4f`; no approval or deployment decision changed.

The pending release-intent queue was already at its 128-item safety bound, preventing a new correction-specific patch intent. `release:completion:check` reported `intent_pending`, not release readiness. Regenerating the shared worktree's CLI release manifest and SBOM from the current bundle made both derived-metadata checks pass. The full Mac run passed 3,901 tests across 775 files with eight existing conditional skips; `pnpm quality:check` passed. Operational installation is distinct from a reviewed CLI release.

A read-only channel poll after r35 found no new human request in `#general` or `#shiflo`. Final installed acceptance still requires a fresh human-authored Elio successor and Shiflo PO-to-Nuri-to-Sora execution, plus controlled redelivery, failure, retry, and restart evidence before resolving the held conversation approval.
