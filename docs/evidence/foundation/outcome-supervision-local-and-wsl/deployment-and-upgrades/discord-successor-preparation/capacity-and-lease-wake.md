# Origin conflict, capacity, and lease-expiry wake

## Installed origin-conflict refusal

Fourteenth goal `wks_da5314d48a7c4561c0a222ba` started 15649 under `supervision.discord.acceptance.next14`, installation 15650, mandate `sha256:736fffe79b878b46683f7f0d9515d32a5c19b7a025de22a4d4087080652d79b7`. Same request bound locally at 15651 while stopped. Service started at 2026-09-14 14:21:24 UTC on `4b536009`; `/goal` reached `#lervo` at 14:22:10 while the fence was free before first cycle.

Within about 50 seconds both acknowledgement and reply showed `origin_conflict`: “현재 목표에는 이미 다른 요청이 연결되어 있어 이 요청을 연결하지 않았습니다. 새 요청은 별도 목표로 접수해야 합니다.” No untyped error or second `work.supervision.bound` appeared. Local allocation, claim 15686, workspace, and dispatch 15692 continued. Installed refusal observations now included old untyped expiry, `owner_busy`, `workstream_inactive`, and `origin_conflict`.

An operator click first opened channel settings and typed into the topic field. It was cleared and the dialog closed without saving before sending from the message composer.

## Fifteenth-goal execution-event capacity failure

Fifteenth goal `wks_24a1a292a871bce0e7460a08`, successor of the fourteenth under `supervision.discord.acceptance.next15`, targeted lease-expiry wake without restart. It bound locally and started; a user revision prepared two seconds after claim 15875/14:34:26 did not apply. Original workspace 15879, dispatch 15881, passing verification 15920, and confirmed effect 15925/14:37:55 followed, then no owner decision. Health said `supervision_cycle_failed` without reason; the handler discarded the error and journal was empty.

Revision `fd6cf5e5` adds one bounded line per failed cycle and a bounded health reason. Node `582ad69c` then failed startup with `startup_failed: The execution event evidence source cannot be verified safely and completely`; systemd restarted it 32 times before it was stopped.

SQLite integrity was `ok` and chain verified: this was capacity, not corruption. There were 8,220 execution-type events, approximately 3.2 MB of relevant fields, beyond the source's 8,192-event cap. Both startup and every knowledge-readiness owner cycle open this complete source and failed closed. ADR-0403, linked from the entrypoint, raises the count to 32,768 while preserving 16 MiB, revision `1ed4fd78`. The worker CLI reads the same source, requiring a joint rebuild.

WSL Node `07487e03c00ed7c3c9b1b6661246e873522f12050713bc055b6e07580a86a7af` and CLI `96547e472dd32760a3095792ecfced46ca189e66d703db9581a61f742d58f41e` came from that revision. Both installed `lervo` and managed CLI path switched. Service started on the 8,220-event repository at 15:07:07; decision 15926/15:07:51 resumed goal 15. Lease wake was not demonstrated by this goal and was retried later.

## Amendment over a proven-unstarted checkout

Resumed goal 15 requested rework 15957, revised/re-dispatched 15993/15999, and completed. Sixteenth goal `wks_d93c5279723019a4a370fde5`, `supervision.discord.acceptance.next16`, repeated the change. Graceful stop one second after claim 16181/15:21:05 again allowed workspace preparation; user revision 2 was 16187. Manual restart at 15:25:47 followed lease expiry.

Owner proposed amendment, but from 15:36 a bounded failure repeated every 21 seconds: `The amendment must preserve an unstarted, workspace-free assignment and current owner authority.` Canonical amendment refused all workspace records although plain revision already admitted checkouts proven unstarted.

Revision `9a182fe5` permits amendment only when every assignment checkout has positive unstarted proof; started or unproven checkouts remain refused. Node `ff6b07aa0c7a3296491196375ec72b789fca64dc4cafec25c7affcea174e878f` deployed during the loop. Its first cycle admitted `assignment.amended` 16219/15:40:51, successor claim 16222, and revised dispatch 16228. Review accepted 16338; revision 3 completed 16371.

## Lease-expiry wake without restart

Seventeenth goal `wks_bfe748f01decf9fd0ddcdf1f`, `supervision.discord.acceptance.next17`, used corrected timing: graceful stop one second after claim 16410 (recorded lease until 15:56:40), workspace completion 16414, user revision 2 at 16416/15:52:08, immediate restart 15:52:10 while live.

On `ff6b07aa`, automatic dispatch for leased/prepared assignments hit the stale guard every roughly eight seconds: `The responsibility for asn_294220c720ab1ea7d6accc08 was bound under goal revision 1; the goal is now revision 2`. Revision `a29063b4` makes this path skip stale duties and return no plan so the owner reasons.

The source records a no-restart wake: the periodic cycle at 15:56:11 reasoned with an expired-lease observation, proposed `revise_responsibility` at 15:58:28, and amended the proven-unstarted checkout at 16478/revision 3. This recorded cycle timestamp precedes the separately recorded 15:56:40 expiry; both observations are retained without reconciling them. Generation-2 claim 16481, new workspace 16485, revised dispatch 16487, verification 16528, independent acceptance, and completion followed. The five-second loop and sixty-second authority audit reread lease state; a lease-expiry deadline in the supervision report is not required.
