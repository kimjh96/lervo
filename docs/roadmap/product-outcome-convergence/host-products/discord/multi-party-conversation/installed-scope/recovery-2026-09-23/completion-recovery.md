# Vero completion recovery and r53 evidence

## Completion projection crash

The first later human-authored Vero continuation exposed crash inconsistency at r52 activation. AXLI accepted Discord message `1551985802483994696` as source event `cve_03b2a6de676fe2c6beba036a9a3866fef13ffc0cddbcf93510ed5b6346ab2b38`. Native repository work completed with passed verification, advanced AXLI's workstream to revision 558, and committed canonical `conversation.repository_work.completed` sequence 17082.

The service stopped before local `repository-work.sqlite` projection commit. After restart, the still-running projection could not discover the late canonical event through the old bounded global-event page. The interaction exhausted two attempts and delivered generic terminal-generation failure despite successful work. Inspection also found a separate five-minute content-hash heuristic incorrectly coalescing independently authored repeated phrases and returning fixed application prose.

## Recovery contract

The correction removes cross-event text/hash coalescing, preserves exact source-event replay idempotence, and resolves canonical completion by deterministic run coordinate.

Startup repairs only local running projections with one exact matching source event, worker, provider, request hash, and passed verification. It neither reruns providers nor publishes old messages. Exact-event re-entry may reuse the stored provider-authored result. Missing or conflicting canonical evidence fails closed as an unconfirmed effect, not generic generation failure. The historical Vero request is not replayed as a fresh human turn.

## r53 deployment and evidence

Commit `abee07c21ed5` supplies the correction in Linux Node distribution `sha256:b744d9eae758508c8f28a42be57ebba159aeb21bcbaa6d3f0431d72ddff4c743` (`runtime-b744d9ea-r53`). The archive passed construction, embedded smoke verification, and all seven installed configuration preflights.

AXLI activated first. Its interrupted Vero row changed from `running` to `completed` using existing canonical result hash `sha256:0932e65f7385e435d6bb37122b030ddee1906931a4859524741fe5d828239e5f`. The exact source retained one historical delivered outbox row, proving startup created no replay publication.

The remaining six services upgraded sequentially. Three consecutive fleet observations found all seven services and all runtime components ready, matching health/systemd main PIDs, and zero restarts. Two Shiflo Gateway connection failures during initial reconnect did not recur after readiness. Exact r52 service definitions remain owner-only rollback inputs.
