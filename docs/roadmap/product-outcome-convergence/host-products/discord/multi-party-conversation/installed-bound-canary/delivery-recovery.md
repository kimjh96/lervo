# Delivery recovery and bound peer observation

## Historical Elio outbox repair

On 2026-09-19, an independent live inspection found Elio outbound `cvo_533a9d6f3e1c1eb309d760485e0421da08d7eb7923e9404937906adb46fad578` pending after 143,000-plus attempts with `adapter_delivery_failed`. Its source was Tarin's 2026-09-10 message `1547498867006767124`.

Discord REST returned Elio application-bot reply `1547498951605751819` in the exact general channel at `2026-09-10T06:48:21.203Z`. Author, source reply, 327-byte size, and SHA-256 content hash matched the immutable outbound. The replay record was `sending` with its original request hash; current serialization computed a different hash. Automatic replay blocked a second send, but the interaction outbox kept retrying.

The exact observed message was recorded through existing replay and correlation stores, then the leased outbox was acknowledged with the verified receipt. It became `delivered` at attempt 143,660; the count stayed fixed after another scheduler interval. No new message was sent or credential exposed. The historical cause of interrupted post-send persistence remains unproven. ADR-0424, linked from the [canary index](../installed-bound-canary.md), defines bounded prevention and future operator reconciliation. This repair does not discharge Shiflo's separate two-direction approval.

## Real-data migration and reconciliation checks

Before r32 activation, r31 still used version-1 interaction storage. A consistent SQLite backup migrated to version 2 without changing its 340 inbox, 340 decision, or 75 outbox records. The repaired Elio row retained `delivered`, its receipt, and 143,660 attempts. Integrity and foreign-key checks passed. Against the actual observed Discord message, the new reconciliation command returned `already_delivered` without writing.

A second temporary backup was transformed into an equivalent version-2 `attention_required`/`sending` pre-repair fixture. The command returned `ready_to_reconcile` in preview, `reconciled` on explicit apply, then `already_delivered` on repeated apply, preserving attempts. Only temporary backups were changed; they were removed after verification. This validated migration and the operator path on real data before installation.

The first full Mac run passed 3,887 tests and failed four: two scheduler/wakeup timing cases that passed alone and two first-publication fixtures whose CLI release manifest bound older bundle hashes than the built shared worktree. The new reconciliation evidence test was changed from `node:test` to repository Vitest and passed its focused rerun. `pnpm release:manifest:check` independently confirmed the CLI artifact mismatch. Repository manifest and SBOM update commands refreshed only derived artifact fields; both checks and the failing first-publication fixture then passed.

A second full Mac run with four workers passed 3,892 cases and failed only the scheduler kill-switch wakeup timing assertion, which passed alone. Eight live/process tests were skipped under existing conditions. Metadata refresh is not deployment approval; release completion remained `intent_pending`.

## r32 canary activation

Linux distribution `sha256:87a403dfd74ac22881dde5f5ca12345f708ea143f1121f05af3c127c06e11d99` was archive-verified, installed immutably as `runtime-87a403df-r32`, and preflighted against the existing canary configuration. Its exact r31 service definition was preserved in the owner-only acceptance directory before upgrading only the canary.

Process `1635147` ran r32 with zero restarts. The live interaction store migrated to version 2 and retained Elio's repaired outbound as `delivered` at attempt 143,660. At `2026-09-19T14:52:36.711Z`, conversation, supervision, sync, workstream replication, and remote control were `ready`. Configuration retained agent `agt_3dd1b5bbabc943d145d5056b`, participant `ptc_lervoelio01`, application bot `1547393266193006632`, and `speaker.kind: bot`.

The separate WSL review remained active at revision 2 with the same blocking approval. The six product-owner Nodes were not upgraded by this canary step. AXLI's unrelated fleet degradation remained visible.

## Bound peer observation and r33

The installed parallel-workstream review exposed a remaining selected-head dependency: `SupervisionPeerSource` read a peer's selected `current.json` and rejected its exact mandate binding when another review was selected. It now reads the peer's canonical bound workstream.

A regression keeps a separate deployment review selected with approval held while the peer returns its bound goal. Existing team-support and central-escalation handoff tests still pass; the two focused files passed 4/4 on Mac and WSL.

Linux distribution `sha256:3ccc646a0513720903dcf779f2297b193c9c05e18149f827f418e773472348f4` (`runtime-3ccc646a-r33`) was archive-verified, preflighted against all seven existing configurations, and installed one service at a time on Elio, Shiflo, Plen, Flemo, Digimon, and Arca-next. All six returned to conversation `ready` with zero service restarts. AXLI's active on-demand preview was not interrupted.

## Historical Tarin collision

A read-only audit found Tarin outbound `cvo_5f8d64457b908857eebea407f5fb153ab72ecfdbf78eb7bcaf3a7a191f06995e` in `attention_required` after 20,589 attempts. Its replay row claimed Discord message `1550438221538918411`, which predated the outbound, had a different content hash, and was already verified delivery for another outbound. Reconciliation preview rejected it. A later content-matching message replied to a different source and also cannot reconcile this outbound. No resend or false receipt occurred.

Across active platform replay databases, this was the only observed external message ID linked to two delivered replay records. Both original assignments shared a discussion ID and first-assignment nonce. Discord's documented `enforce_nonce` behavior can return an earlier same-author message. This supports the historical collision explanation; original HTTP response bytes were not retained. Newer assignment-stage nonce separation remains in place.

## Discord response guard and r34

Before accepting a create-message response as delivered, the bot REST adapter now checks returned content and exact native reply target as well as channel and optional returned nonce. An earlier returned message with different content or reply remains uncertain delivery; it cannot complete replay or acknowledge the interaction outbox.

Nonce-collision regression and relevant conversation/Discord suites passed 65/65 on Mac; focused WSL cases passed 33/33. Linux distribution `sha256:312d0ad6469e2923eb269f4c105badff2d9f7a39f075cc63e7e44b6167b0e3d0` (`runtime-312d0ad6-r34`) was archive-verified, passed all seven configuration preflights, and replaced r33 on the same six services. Exact r33 definitions were retained. Each reached overall and conversation `ready` with zero restarts; Elio and Digimon supervision were also `ready`.

Elio retained agent `agt_3dd1b5bbabc943d145d5056b`, participant `ptc_lervoelio01`, application bot `1547393266193006632`, and `speaker.kind: bot`. Tarin's unmatched row stayed `attention_required` at 20,589 attempts; Elio's 75 outbox rows remained delivered. AXLI stayed on r28 with preview listening on `127.0.0.1:4317`. The selected review stayed active at revision 2 with blocking deployment approval `wapr_e4cd367a01b02a4f`.

These corrections prevent a newly observed wrong response from being recorded as success. They neither supply the missing human-authored two-direction acceptance matrix nor authorize approval.
