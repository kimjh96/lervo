# V3 fleet supervision and r52 no-replay evidence

## Installed authority

Commits `f402544d4c77`, `bcc3e92b67`, and `c7d836f701` require the exact installed owner for goal intake, replace V3 standing owners' cumulative lifetime ceilings with per-attempt admission, and validate successor mandate revisions against the bound workstream. Reviewed V3 mandates are installed for all seven product owners; each deployment advertises goal acceptance only for its exact installed authority.

| Product owner | Mandate hash |
| --- | --- |
| Lervo, active successor | `sha256:98765b5733255b9acf7ffed38277c5164aea63412a802e79f7b27b7df4f9b51e` |
| Plen | `sha256:489b75ea1b88f6370814bf426645f868256a5183873b73ff8701124d229e88ce` |
| Shiflo | `sha256:b9675ad3bf27269c554f75350c131877add0b26538675b88fd6612e40601c036` |
| Flemo | `sha256:73063d4efa35494c298aa99cb1ea1aec2b3156703f5a38a8aef4110126cef006` |
| Arca-next | `sha256:398c2cd356cac691d5e32ffb7a7f118f4a80af9db45abee5f0af655fa0a09465` |
| AXLI | `sha256:72d51c6755d66a6f9781530c90af03e090371f33e7374d6b1329a1fd48318e84` |
| Digimon | `sha256:8ecaf404b98697c723df4af46815bbf99c738b5d9379d2c2c6ae5d1a105757ac` |

## Installation is not instruction

First activation exposed authority installation and service restart as unintended work triggers. Before the fleet stopped, AXLI reconciled and claimed old work; Digimon created and claimed an assignment from pre-existing state. Those canonical events remain retained, neither deleted nor represented as human requests.

Commits `0ccce869e45c` and `a1e20c34befa` require an exact `work.supervision.bound` origin before any supervised lease, peer refresh, pending result delivery, recovery, reasoning, or effect. A process starting with a pre-existing origin records only its current source cursor unless an already recorded effect needs safe reconciliation. Ordinarily, only a later canonical source change or a request bound after startup wakes it.

Second activation exposed Arca's old `supervision.discord.arca.standing` typo and pending result recovery preceding the snapshot-level gate. Final configuration uses `supervision.discord.arca-next.standing`; the gate now precedes the owner lease itself.

## r52 deployment and evidence

Final Linux Node distribution `sha256:6c89d41983f0e9abc72175eec328c9737d66efb61444fb8dd568ad68feeed177` (`runtime-6c89d419-r52`) passed archive construction, archive verification, smoke installation, and all seven configuration preflights. The unchanged managed CLI bundle is `e8a41886a3b722df27ee6d17dd907d307053511956332e701bdd3791979ec968`. Exact r51 configurations and service definitions remain owner-only rollback inputs.

Three consecutive fleet observations found every r52 service `active/running`, matching health/systemd main PIDs, zero restarts, and ready conversation, synchronization, workstream replication, and remote control. Lervo and AXLI reported supervision ready for pre-existing exact bound goals without a startup effect. Shiflo, Plen, Flemo, Arca-next, and Digimon reported `dormant:workstream_inactive`, with no exact request bound.

Across two later complete fleet snapshots, every repository retained its event count, event head hash, Git HEAD, and working-tree status hash. This proves no r52 startup replay; fresh independently human-authored Lervo and Shiflo response turns remain required.
