# Bound-workstream canary and publication diagnostics

## Installation and binding

On 2026-09-19, Linux Node distribution `sha256:05f04a3972b54d02681456397ba59d6b39fcdcbf4b6b177cf5d03a70d09a5787` was built, archive-verified, installed immutably as `runtime-05f04a39-r29`, preflighted against the existing configuration, and activated only on canary service `nfi_28de5803e2db5aec8bd4ee7d`. Its r28 service definition was preserved byte-for-byte for rollback. r29 stayed active with zero restarts; after startup reconciliation, conversation, sync, workstream replication, remote control, and supervision were `ready`.

A final recovery guard rejects a prepared successor that changes before mandate installation; its regression passed on Mac and WSL. Verified r30 distribution `sha256:4f4c17883877e5da2d650f14c8db79b036aa9f7f769c2aad26c7db5446ad231a` was preflighted and installed only on the same canary, retaining its exact r29 definition for rollback. Process `1433991` stayed active with zero restarts; the post-reconciliation observation at `2026-09-19T13:09:37.480Z` reported all five subsystems `ready`.

The configuration still binds Elio's existing durable agent `agt_3dd1b5bbabc943d145d5056b` and participant `ptc_lervoelio01` to application bot `1547393266193006632` with `speaker.kind: bot`. Standing owner binding remains `supervision.discord.standing`. No agent, application bot, or same-named webhook was created.

Canonical events/CAS showed bound Elio workstream `wks_57cba9746df356647c1d72e3` completed at revision 4, independently of selected review `wks_595331423aaba2b1e67cacfe`, active at revision 2 with blocking approval `wapr_e4cd367a01b02a4f`. Readiness proves service and binding coexistence with that review, not a new human-authored Elio request or a started/completed successor goal.

## Lineage and identity evidence

A later read-only WSL audit resolved Elio's standing lineage to successor index 3, supervision `supervision.discord.standing.s3`, the same owner agent, and the completed revision-4 bound workstream. It read the selected review and approval independently without changing projection bytes.

Elio's last observed bound supervision effect was `2026-09-16T07:52:57.673Z`; the selected review's first snapshot was `2026-09-18T05:58:40.544Z`. Historical owner effects therefore cannot prove an installed owner cycle while the review was selected and held. r34's `supervision: ready` likewise proves readiness only. ADR-0423 acceptance item 1 still requires a fresh authorized owner cycle on a successor goal with the review unchanged.

A separate live identity check used only Elio's configured application-bot credential:

- Discord `GET /users/@me` returned HTTP 200 and bot user `1547393266193006632`.
- `GET /channels/1546479355771883612/messages/1547498951605751819` returned HTTP 200, the same author, no `webhook_id`, and expected source reply `1547498867006767124`.
- Repository inspection returned active revision-2 `Elio`, agent `agt_3dd1b5bbabc943d145d5056b`; Node configuration still mapped that agent and `ptc_lervoelio01` to the same bot.

These checks prove the installed principal and historical authorship, not a new human conversation or completed parallel owner cycle. No credential value was recorded.

## Validation and remaining acceptance

Mac native supervision completion passed 10 scenarios, including a selected parallel review. Local and WSL bound-state, standing-lineage, and selected-replication tests passed, with WSL 15/15 including recovery of a successor prepared before restart. The Hub workstream protocol still publishes only the selected head; no second cross-host writer for Elio's branch is claimed.

The held two-direction conversation approval and publication-verification investigation remain open pending the exact installed human-authored evidence matrix. This canary rollout did not resolve approval.

## Publication diagnostics canary

Read-only inspection found older `publication_verification_failed` rows in installed canary interaction databases without a durable verifier subtype: the response-attempt boundary discarded every verifier error before persistence. The generic code cannot reconstruct the historical cause.

The failure classifier now retains privacy-bounded writing, evaluation, storage, or deterministic contract failure codes for new verifier failures. A nonretryable contract mismatch immediately uses the verified terminal response; unknown failures keep the generic code. Rejected message and artifact content is neither stored in the failure field nor emitted through the bounded private error-coordinate logger.

Linux distribution `sha256:f2338b2794aac01be2558344e720eff626d62d41d811491cded40cdea79883e4`, installed as `runtime-f2338b27-r31`, passed archive verification and the existing owner-only configuration preflight. Only canary service `nfi_28de5803e2db5aec8bd4ee7d` was upgraded; the exact r30 definition remains available for rollback. Process `1468703` was active with zero restarts. At `2026-09-19T13:28:47.016Z`, conversation, sync, workstream replication, remote control, and supervision were `ready`.

Elio's agent, participant, and application-bot mapping remained unchanged; the selected review stayed active at revision 2 with the same blocking approval. Focused conversation, interaction, Discord payload, and failure-classification tests passed 45/45; provider adapter common-contract tests passed 46/46. Tests and readiness neither replace a fresh human-authored two-direction installed run nor approve the held deployment.
