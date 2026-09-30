# Product-owner Node rollout and held acceptance

## Shiflo acceptance-target rollout

On 2026-09-20 KST, observed channels contained no new human-authored Elio or Shiflo acceptance request. Shiflo still ran r28, so a fresh request would not exercise current bounded delivery and publication diagnostics. Its existing configuration passed immutable r32 preflight. Read-only inspection found four active integrations with only delivered outbox rows: Ruen's existing application bot and Sora, Nuri, and Dami's distinct existing webhooks. Current membership names and agent IDs came from the installed Shiflo repository, not a fixed role list.

Consistent SQLite backups of each active interaction store migrated on temporary copies from schema 1 to 2, preserving every inbox, decision, and outbox row hash. Integrity and foreign-key checks passed. Before upgrade, 39 conversation SQLite databases were backed up consistently to owner-only `shiflo-r28-interactions-backup`, with an integrity-checked manifest; the exact r28 service definition was saved separately.

The r32 upgrade retained Shiflo configuration hash `sha256:a49696dbaa6925811f5a2e1fd8979d95de161e39578ebb4e2cca36a98de461fc` and activated process `1665208` with zero restarts. At `2026-09-19T15:02:23.752Z`, conversation, sync, workstream replication, and remote control were `ready`. All four active interaction stores migrated to schema 2 and retained only previously delivered outbox rows: Ruen 123, Sora 7, Nuri 2, Dami 1. No agent, participant, application-bot, or webhook ID was replaced.

This prepared the actual PO-to-hired and hired-to-hired surface for human acceptance; it did not supply that evidence or clear separate review approval.

## Other product-owner r32 upgrades

On 2026-09-20 KST, existing Plen, Flemo, Digimon, and Arca-next configurations passed immutable r32 preflight. Before each upgrade, a temporary copy of the active interaction store migrated from schema 1 to 2 with inbox, participation-decision, and outbox row hashes unchanged; SQLite integrity and foreign-key checks passed. Consistent conversation-database backups and exact r28 systemd definitions were retained in the owner-only acceptance directory.

The four existing services were upgraded individually to `runtime-87a403df-r32`, without creating or replacing agent, participant, bot, or webhook identities. Each returned to conversation, sync, workstream replication, and remote control `ready`, with zero systemd restarts. Active stores migrated to schema 2, passed integrity checks, and retained only delivered outbox rows:

| Deployment | Delivered rows |
| --- | ---: |
| Plen/Lumi | 86 |
| Flemo/Miro | 21 |
| Digimon/Sera | 32 |
| Arca-next/Kael | 65 |

Digimon supervision also reported `ready`.

At the final fleet observation, Elio, Shiflo/Ruen, Plen/Lumi, Flemo/Miro, Digimon/Sera, and Arca-next/Kael were active on the same r32 bundle with conversation `ready` and zero restarts. AXLI/Vero remained on r28: its user-requested on-demand preview still listened on `127.0.0.1:4317`, process `1315394`, and upgrading AXLI would interrupt it. AXLI's separate degraded supervision was neither presented as healthy nor silently restarted.

Selected WSL review `wks_595331423aaba2b1e67cacfe` remained active at revision 2 with blocking deployment approval `wapr_e4cd367a01b02a4f`. A fresh read of `#general` and `#shiflo` found no new human-authored acceptance turn after these upgrades. The rollout therefore claims neither two-direction normal/redelivery/failure/retry/restart evidence nor operational approval.
