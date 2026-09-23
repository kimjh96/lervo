# Installed multi-party scope

Part of [Role-backed multi-party conversation](../multi-party-conversation.md).

## Deployments and context

The [2026-09-19 bound-workstream canary record](installed-bound-canary.md) separates the new Elio supervision rollout from the still-held conversation approval.

The installed Node accepts a bounded collection of distinct Discord agent deployments. Each bot speaker uses its own application. Webhook speakers may share the exact Gateway application and bot credential while retaining distinct webhook IDs, owner-only webhook tokens, hired-agent bindings, current role hashes, provider and model routing, storage, response ownership, and delivery adapters.

Every owned agent turn loads that agent's reviewed context through the managed context coordinator used for repository search and evidence.

## Turn ownership and peer binding

Shared-guild peer author and mention aliases normalize to the peer's single workforce participant. Before semantic relevance, deterministic turn ownership:

- Assigns exact participant mentions to their addressees.
- Resolves Discord-managed bot-role mentions to exact bot participants only after authenticated guild-role verification; unresolved role addresses do not fall through to the channel default.
- Selects one participant per mentioned role.
- Selects a stable participant for unaddressed turns from explicit per-participant priorities shared by local and cross-Node bindings. A deployment may configure the central executive as the general-channel default without giving the `CEO` role string special behavior.
- Retains a human's explicit interlocutor across hiring-driven runtime restart without turning the newly hired work assignee into the human's conversation target.
- Releases missing or idle interlocutors and deterministically selects exactly one current owner.

Non-owners record `turn_not_owned` without typing or provider work. Typing starts when an owner begins semantic resolution and continues through an active native work turn. Bounded recent context retains the speaker's participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

A successful hire publishes its bounded acknowledgement before requesting runtime reconfiguration. Hiring or assigning work does not itself change the human interlocutor. The owner of a subsequent work instruction starts visible typing and must end in one verified result, duplicate-suppression notice, or bounded terminal failure; silence is not a successful lifecycle state.

Within a multi-bot Node, an exact reviewed manual participant binding overrides the automatic co-resident peer binding for the same tenant and speaker identity. This lets a coordinating agent start a bounded automation chain without conflicting identity rows or extending the override to every peer.

## Proactive signals, deliberation, and effects

Installed Node deployments can map bounded canonical repository event types to proactive signals and run explicit cross-provider deliberation through the durable queue. Both preserve deterministic turn ownership, managed retrieval, provider budgets, repository verification, CAS, and event evidence. Discord is only the current transport.

Named conversation speakers and formal-deliberation participants are separate identity planes. An ordinary Discord speaker is backed by a durable hired-agent binding (`agentId`, role version and hashes, participant, and bot or webhook deployment). A formal policy seat remains internal unless an explicit participation route joins it to one exact active organization membership, deployment, channel membership, provider policy, model, and effort. The repository-local participant runtime must accept that immutable route before execution, work causality records the durable agent, the verified workforce role supplies its role and context profile, and artifact publication uses the already attached speaker deployment without a synthetic seat heading. Presence, provider compatibility, or a matching job label cannot create the binding. User-facing copy must not present an unbound policy role as a speaker, and installation work must not create same-named shadow webhooks or agents for an already bound application bot.

The installed executive boundary executes hash-bound, allowlisted Discord text-channel and public-thread effects with durable replay and fail-closed uncertainty. The installed deliberation worker reconciles uncertain outcomes from canonical CLI evidence and publishes a bounded visible result through the managed conversation path.

Natural deliberation preserves the original human reply coordinate across synthetic status signals, retains bounded prior human anchors for references such as "this design," and selects a versioned Korean or English conversation writing contract from the source request. Failed writing checks are supplied to the one bounded repair attempt instead of repeating an undirected rewrite.

## Implemented capabilities

- Webhook-backed delivery.
- Same-Node and explicitly bound cross-Node peer-author normalization.
- PO-to-worker, worker-to-PO, and worker-to-worker addressed delegation through receiver-owned runtimes or exact cross-Node Discord addresses.
- Explicit peer display addresses and unaddressed priorities shared across Nodes.
- Shared-Gateway validation and replay-safe executive webhook preparation.
- Authenticated parent/thread resolution and native thread delivery.
- Bot-native replies and source-message reply correlation.
- Natural allowlisted text-channel and current-channel public-thread creation.
- Natural repository-scoped child-agent hiring by an exactly bound product owner.
- Atomic child organization, external-deployment, and channel-membership binding before supervised activation.
- Exact leading `@DisplayName` addressing for webhook-backed participants that Discord cannot natively mention.
- Resumable native Codex and Claude repository work with durable per-agent sessions, duplicate suppression, bounded result artifacts, and Git change observation.
- Provider-native progress-renewed inactivity windows with a separate absolute turn bound for both Codex and Claude; neither a fixed wall-clock cut during active verification nor an intermediate message is a completion receipt.
- A WSL single-writer execution default that keeps native conversation work available while conflict-safe Mac recovery replicas preserve exact uncommitted worktree and index bytes for explicit reconciliation. Strict fresh parity remains opt-in for controlled topologies, with bounded peer-command execution, configurable bridge concurrency, and terminal completion detection for an unloaded installed coordinator.
- Post-turn enforcement of current workstream, canonicalization declaration, and repository knowledge lifecycle, plus bounded CAS-backed prior work results per durable worker.
- Stable CEO ownership for unaddressed general-channel turns and early owner-only typing activity.
- Bounded durable human-interlocutor focus shared by co-resident deployments and recovered after restart.
- Semantic repository-work profiles that route routine work to balanced settings and design, judgment, and review to high-effort settings, while preserving provider-bound session identity and recording the allocation reason.
- Repository-local named formal participants with distinct policy-seat and workforce-role evidence, seat-specific model and effort, resume stability, and existing-speaker publication.
- Internal-only treatment of unbound policy coverage, actual bound-role context loading, repair headroom above the 24-call best-case baseline, and exact terminal failure reasons in Discord.
- Pre-provider natural-discussion admission that requires at least two distinct verified real participant runtimes and otherwise returns a bounded no-work reply without queueing or partial publication.
- Authenticated cross-Node natural discussion between the decision owner and two selected real bot peers, with receiver-owned envelopes, identity-normalized explicit active targets, exact agent bindings, per-agent role and repository context, serialized independent review turns under one installed-host provider slot, content-addressed contributions, and one coordinator synthesis.
- Discussion coordination ownership resolved from durable discussion state before ordinary reply mentions, plus distinct first- and second-assignment nonce sequences so Discord replay protection cannot suppress the serialized handoff.
- Discussion prompts that identify the current durable speaker separately from prior accepted speakers, preserve intentional isolation during independent review, prevent same-role participants from being merged, and treat injected workstream status as historical unless the current turn supplies fresh evidence.
- Restart-safe discussion deadlines that return a bounded non-converged result from verified partial evidence or a fixed no-contribution terminal result instead of leaving an interaction pending.
- Review and synthesis routing through independently configured high-effort execution profiles and per-route time budgets, with routine turns retained on balanced profiles, one safe read-only retry for provider start or terminal-turn failure, and managed usage attributed to the executing agent.
- Provider-reported model overload is distinct from generic turn failure and uses bounded read-only backoff; Claude native work accepts a final assistant body only when its terminal result explicitly reports success and the body followed the last tool interaction.
- A configured request-scoped runtime effect whose Node-owned process survives the provider turn without boot enablement or automatic restart, and stops on explicit close, bounded expiry, or Node shutdown.

## Limits and remaining work

Webhook replies remain canonical rather than native. Natural product-owner hiring already invokes agent-deployment preparation, organization binding, runtime configuration, and post-acknowledgement restart for the durable child speaker. Remaining work includes extending that governed path to a natural central-executive request across repository teams and broader natural addressed groups. Cross-Node natural discussion now uses the authenticated receiver-owned protocol from [ADR-0421](../../../../../decisions/coordination/conversations/agent-organization/0421-separate-real-agent-discussion-from-policy-coverage.md); repository-local co-resident formal participants remain a separate policy-seat capability, and the implementation does not claim that a remote repository agent executed a formal turn without formal-route evidence.

Webhook task results are presentation-only on Discord; the co-resident router carries the authenticated result to its coordinator. Remote task delegation over Discord's nonce transport is limited to two application-bot speakers until an authenticated receiver-owned webhook control envelope exists. [ADR-0425](../../../../../decisions/coordination/conversations/delivery/0425-separate-webhook-publication-from-task-control.md) records the source correction for unaddressed webhook observation and its pre-send limits. Acceptance must verify that a webhook worker's visible result and the coordinator's exact task-ID continuation both occur once, including after restart; passing adapter tests or a healthy service is insufficient.

The owner previously authorized product-owner-to-hired-agent and hired-agent-to-hired-agent operation. Installed technical acceptance remains open until one two-direction evidence run shows exactly one processing and exactly one publication for every request across normal, redelivered, failed, retried, and restarted turns. That run must correlate the durable inbox, participation-decision, outbox, and interlocutor-focus rows with the observed channel result for the same request identifier. Its failed-delivery branch must also distinguish a nonce-reused earlier Discord message from publication of the requested outbound, leaving the mismatch unacknowledged and unsent again. Component coverage of duplicate suppression, focus recovery, and turn ownership does not substitute for it. The capability stays deployed during acceptance; it is not withdrawn.

The native Vero recovery path has one fresh human-authored installed continuation after the r42 deployment. Human `#axli` message `1551204065739018352` was owned by Vero as event `cve_2165332d0cd35860a39332a9cb2c8e79e815bc94b5fb46598b46308ae0224c16`; one resumed Codex `gpt-5.6-sol` high-effort turn completed without a failure code, and AXLI's canonical workstream advanced to revision 255 with an exact-face fixture-sweep verification artifact. The inbox completed on its first attempt, outbox `cvo_3e8f09e22f147b6fa12cf12f4e05292ea20d2df88fd7a43f442980ae3ddd8ed4` delivered once, and Discord GET verified Vero application-bot reply `1551208510430388295` with both messages correlated to the same source event. The earlier failed native turn was not replayed. This closes the single-turn installed Vero continuation check; it does not prove every overload or failure branch in production. A failed native work turn with possible repository effects still requires inspection and cannot be replayed as a read-only capacity retry.

On 2026-09-21, Vero's human goal request exposed that successful supervision intake replaced the managed turn's request-grounded reply with one fixed Korean success promise. Commit `f648ed39ecb871fcb06f835cb18bb4a807d2fae0` retains the managed acknowledgment only for a newly bound request, requires it to describe the understood outcome or priority without claiming admission or completion, and continues to publish verified deterministic state for duplicates and refusals. Linux Node distribution `sha256:43fe7006bc624161e9ebcf76f12d58fd8ac94640edb3ae48a3c44903ddfecdee` (`runtime-43fe7006-r45`) passed the focused 16-test suite and all seven configuration preflights before sequential activation on AXLI, Flemo, Plen, Shiflo, Arca-next, Digimon, and Lervo. Exact r44 service definitions remain owner-only rollback inputs. All seven services run r45 with active systemd state, matching health and service PIDs, zero restarts, and conversation readiness. Six report overall ready. AXLI's conversation, sync, workstream replication, and remote control are ready while its separate supervision remains degraded with the pre-existing `aggregate_budget_exceeded`; the rollout neither renews that budget nor proves a fresh post-fix Vero reply.

On 2026-09-22, the Windows target remained reachable while its WSL distribution stopped accepting commands. An explicitly approved WSL shutdown and restart restored the Hub and all seven r45 services before rollout. Commit `2394c079efb67e6b3f724725811f21f24bebaf4d` adds typed uncertain-effect reporting, bounded supervision-admission retry, host-owned recovery of a missing repository-work checkpoint, repository-work routing evidence, and evidence-bound connector, configuration, and timestamp claims. Linux Node distribution `sha256:9a4d8fcd81894776cfce493643473c779cf9acb839a9d1e7e309dfc551846a22` (`runtime-9a4d8fcd-r46`) passed archive verification, smoke verification, and all seven configuration preflights. Exact r45 definitions were copied to owner-only rollback inputs before Lervo, Shiflo, Plen, Flemo, Arca-next, AXLI, and Digimon were upgraded one at a time. Three consecutive fleet observations found the new executable and matching health PID on every service with zero restarts. Lervo, Shiflo, Plen, Flemo, Arca-next, and Digimon were overall ready with conversation, sync, workstream replication, and remote control ready. AXLI retained those four ready components while its separate supervision remained degraded with the unchanged `aggregate_budget_exceeded`; no budget was renewed.

The rollout also exposed that the standalone readiness checker rejected the Node's documented optional `supervision` projection. Commit `72768c25539b9af792c04f15a71c8d7692264ec3` aligns that checker with ready, disabled, dormant, and bounded unavailable supervision states. The corrected checker reports the six ready Nodes as ready and AXLI as not ready because aggregate readiness remains degraded, while direct bounded health confirms AXLI conversation readiness. No historical Lervo or Shiflo request was replayed. A new independently human-authored turn in each channel is still required for installed response acceptance.

The next incident exposed a false goal-admission surface rather than missing execution permission. Lervo's central deployment, Shiflo's product-owner deployment, and three other product-owner deployments advertised `acceptsSupervisionGoals: true` without owning the Node's installed `outcomeSupervision` binding. Their fallback stored requests in a local pending database and returned application-authored Korean prose, although no installed authority could execute those requests. Commit `b33447d79865a2e4a8c3a539b0e71f140766a8a7` removes that pending intake and its fixed public responses. Configuration now fails preflight unless every goal-accepting Discord deployment is the exact installed supervision owner. New admissions retain the request-grounded managed acknowledgment; duplicate, refused, and legacy canonical goal outcomes pass typed result evidence through the managed conversation writer. Existing pending rows are inert history and were neither promoted nor replayed.

Linux Node distribution `sha256:7c621b65b29e6dd6096bd8bbfc5d8a13cc9ab5b9a21f4164bf90f50ca804edd5` (`runtime-7c621b65-r47`) passed archive verification and all seven corrected configuration preflights. Lervo's Elio deployment, AXLI's Vero deployment, and Digimon's Sera deployment retain goal acceptance because each exactly matches its installed supervision owner; Lervo central, every Shiflo deployment, Plen, Flemo, and Arca do not expose it. All seven services were upgraded sequentially, then observed three times as `active/running` on r47 with zero restarts. Six report overall ready with conversation ready. AXLI remains conversation-ready and overall degraded only for its pre-existing `aggregate_budget_exceeded` supervision attention.

That rollout also found the Hub still running the 2026-09-19 r25 artifact while the Nodes emitted a later valid schema-v2 event type. Arca's 93-event contiguous outbox began at sequence 5392 with `conversation.repository_work.completed`; the old Hub rejected even that single event with HTTP 400, while registration, authenticated reads, identity, TLS, and the advertised `[1,2,3]` reader envelope remained valid. The Node consequently retried the batch as the overly broad `hub_unavailable` failure. Matching Hub distribution `sha256:f486acc4ffc7257a9af92def51ea41a4f355b61e30ac15583caf3a871364e9c6` (`runtime-f486acc4-r47`) was installed transactionally with the exact r25 service definition retained for rollback. Three consecutive observations found the Hub active on r47 with zero restarts; Arca then acknowledged all 93 events without rewriting them, its outbox reached zero unacknowledged rows, and sync plus workstream replication returned to ready. This establishes the installed compatibility repair but does not replace a fresh human-authored Lervo or Shiflo response observation.

On 2026-09-23, the product-owner fleet was converged on one supervision contract. Commits
`f402544d4c77`, `bcc3e92b67`, and `c7d836f701` require the exact installed owner for goal intake,
replace cumulative lifetime ceilings for V3 standing owners with per-attempt admission, and validate
successor mandate revisions against their bound workstream. Reviewed V3 mandates are installed for
all seven product owners. Lervo's active successor mandate hash is
`sha256:98765b5733255b9acf7ffed38277c5164aea63412a802e79f7b27b7df4f9b51e`;
Plen, Shiflo, Flemo, Arca-next, AXLI, and Digimon use respective mandate hashes
`sha256:489b75ea1b88f6370814bf426645f868256a5183873b73ff8701124d229e88ce`,
`sha256:b9675ad3bf27269c554f75350c131877add0b26538675b88fd6612e40601c036`,
`sha256:73063d4efa35494c298aa99cb1ea1aec2b3156703f5a38a8aef4110126cef006`,
`sha256:398c2cd356cac691d5e32ffb7a7f118f4a80af9db45abee5f0af655fa0a09465`,
`sha256:72d51c6755d66a6f9781530c90af03e090371f33e7374d6b1329a1fd48318e84`,
and `sha256:8ecaf404b98697c723df4af46815bbf99c738b5d9379d2c2c6ae5d1a105757ac`.
Every owner deployment now advertises goal acceptance only for its own exact installed authority.

The first activation exposed that authority installation and service restart were still interpreted
as work triggers. Before the fleet was stopped, AXLI reconciled and claimed old work and Digimon
created and claimed an assignment from pre-existing state. Those canonical events remain retained;
they were not deleted or presented as human requests. Commits `0ccce869e45c` and `a1e20c34befa`
separate installation from instruction: no supervised lease, peer refresh, pending result delivery,
recovery, reasoning, or effect can begin without an exact `work.supervision.bound` origin. A process
starting with a pre-existing origin records only its current source cursor unless an already recorded
effect needs safe reconciliation. A later canonical source change or a request bound after startup is
the only ordinary wakeup. The second activation also exposed Arca's old
`supervision.discord.arca.standing` configuration typo and that pending result recovery preceded the
snapshot-level gate; the final configuration uses `supervision.discord.arca-next.standing`, and the
gate now precedes the owner lease itself.

Final Linux Node distribution
`sha256:6c89d41983f0e9abc72175eec328c9737d66efb61444fb8dd568ad68feeed177`
(`runtime-6c89d419-r52`) passed archive construction, archive verification, smoke installation, and all
seven configuration preflights. The unchanged managed CLI bundle remains
`e8a41886a3b722df27ee6d17dd907d307053511956332e701bdd3791979ec968`.
Exact r51 configurations and service definitions remain owner-only rollback inputs. Three consecutive
fleet observations found every r52 service `active/running`, its health PID equal to the systemd main
PID, zero restarts, and conversation, synchronization, workstream replication, and remote control
ready. Lervo and AXLI report supervision ready for their pre-existing exact bound goals without a
startup effect. Shiflo, Plen, Flemo, Arca-next, and Digimon report
`dormant:workstream_inactive` because no exact request is bound. Across two later complete fleet
snapshots, every repository retained the same event count, event head hash, Git HEAD, and working-tree
status hash. This proves no r52 startup replay; it does not fabricate the still-required fresh
human-authored Lervo and Shiflo response acceptance turns.

The first later human-authored Vero continuation exposed a crash-consistency gap at that exact r52
activation boundary. AXLI accepted Discord message `1551985802483994696` as source event
`cve_03b2a6de676fe2c6beba036a9a3866fef13ffc0cddbcf93510ed5b6346ab2b38`; its native repository
turn completed, recorded passed verification, advanced AXLI's workstream to revision 558, and
committed canonical `conversation.repository_work.completed` sequence 17082. The service stopped
before its local `repository-work.sqlite` projection committed. After restart, the still-running
projection could not discover that late canonical event through the old bounded global-event page,
so the interaction exhausted two attempts and delivered a generic terminal-generation failure even
though the work had succeeded. The same inspection found a separate five-minute content-hash
heuristic that incorrectly coalesced independently authored repeated phrases and returned fixed
application prose.

The correction removes cross-event text/hash coalescing, keeps exact source-event replay idempotent,
and resolves canonical completion by its deterministic run coordinate. Startup repairs only local
running projections with one exact matching source event, worker, provider, request hash, and passed
verification; it neither reruns provider work nor publishes an old message. Exact-event re-entry can
reuse the stored provider-authored result. Missing or conflicting canonical evidence fails closed as
an unconfirmed effect rather than a generic generation failure. The historical Vero request is not
replayed as a fresh human turn.

Commit `abee07c21ed5` supplies that correction in Linux Node distribution
`sha256:b744d9eae758508c8f28a42be57ebba159aeb21bcbaa6d3f0431d72ddff4c743`
(`runtime-b744d9ea-r53`). The archive passed construction, embedded smoke verification, and all seven
installed configuration preflights. AXLI was activated first. Its interrupted Vero row changed from
`running` to `completed` with the existing canonical result hash
`sha256:0932e65f7385e435d6bb37122b030ddee1906931a4859524741fe5d828239e5f`; the exact source retained
one historical delivered outbox row, proving startup created no replay publication. The other six
services were then upgraded sequentially. Three consecutive fleet observations found all seven
services and all runtime components ready, their health PIDs equal to systemd main PIDs, and zero
restarts. Two Shiflo Gateway connection failures occurred during initial reconnect and did not recur
after readiness. Exact r52 service definitions remain owner-only rollback inputs.

The delivery outbox now has a bounded `attention_required` state and a Discord-only externally verified reconciliation path under [ADR-0424](../../../../../decisions/coordination/conversations/delivery/0424-bound-delivery-uncertainty-and-reconciliation.md). An uncertain or failed send is not silently counted as published. The operational approval also requires no unresolved attention state for the exact acceptance requests; a recovered historical message is supporting incident evidence, not a substitute for the two-direction matrix.

Each agent needing native Discord member presence, its own typing indicator, or native mentionability requires a separate installed bot application. Exact Lervo `@DisplayName` addressing remains available to webhook identities.

The request-scoped runtime contract is implemented but remains unavailable until a target repository's owner-only Node configuration explicitly allowlists `requested_runtime.manage` and binds an exact executable, working directory, readiness observation, and lifetime. No existing installed target is inferred from a port number or old conversation, and enabling this capability is not evidence that a particular preview server is currently open.

## Installed natural-discussion evidence

The final 2026-09-18 controlled General-channel run used Node distribution `real-agent-discussion-8c6abe2c-r18` (`sha256:8c6abe2c577d093c4830397f523c06162d76a01fc52459cf3da0635f45cb5a8d`) across all seven installed services. Source message `1550448628802396242` produced first assignment `1550448735580983322`, Lumi contribution `1550448948802625577`, serialized second assignment `1550448950610497601`, Miro contribution `1550449123147124849`, and one Tarin synthesis `1550449257402597398`.

Coordinator discussion `dsc_shHsAv739vvc0lzSBrHw` records exactly two distinct contribution bindings and terminal state `discussion.converged`. Receiver inboxes reconstruct the first assignment as `assignmentSequence: 1` with active participant Lumi and the second as `assignmentSequence: 2` with active participant Miro. The final synthesis identifies both participant and durable agent IDs separately, treats product-specific writing rules and historical workstream reports as scoped evidence rather than shared current fact, and states that the comparison and final decision completed. Every observed message was authored by its installed application bot, had no webhook ID, and contained no HTML comment residue. All seven deployed services, including Axli, used the same immutable r18 runtime and were active with zero service restarts after deployment.

An earlier r15 run additionally exercised Axli participant Vero: discussion `dsc_Yhgah_fxU3JPYiSTzCal` recorded Sera and Vero as two distinct durable contribution bindings and converged. This preserves installed evidence that Axli participates in the protocol rather than merely running the bundle.

These controlled sources were submitted through an existing application-bot credential to exercise the installed protocol; they are not claimed as independently human-authored acceptance messages. They prove the installed serialized receiver-owned discussion path and fixes for the previously observed publication-contract, ownership, nonce-collision, speaker-attribution, and stale-status failures. The broader normal, redelivery, failure, retry, and restart matrix above remains the separate operational-approval gate.

## Installed addressed-mediation routing

The 2026-09-18 `#shiflo` incident exposed two separate routing faults: an exact `@Tarin` address was normalized but fell back to ordinary unaddressed ownership because Tarin was not a candidate in that project conversation, and Ruen's semantic resolver treated any agent mention as if Ruen itself had been mentioned. The response classifier then selected `answer` with no effect and exposed its intentionally read-only classification boundary as though the installed work runner were read-only.

Node distribution `addressed-mediation-813f3a28-r19` (`sha256:813f3a280007f208abf8f215c872f666bf760f9585a4f98e0699959661097c61`) is installed across all seven services. Tarin now has a reviewed binding in every project conversation with per-conversation unaddressed priority `0`; the local product owner keeps priority `10`. Exact Tarin mentions can therefore select Tarin, while ordinary project-channel turns stay with the project owner. Missing exact addressees fail closed instead of reverting to unaddressed ownership, and semantic mention context is computed for the responding participant rather than from the presence of any mention.

All seven services were observed `active/running` with zero current restarts after Tarin's durable organization deployment was rebound and synchronization started. Focused ownership, mode, priority, and deployment-configuration suites pass. One new independently human-authored project-channel `@Tarin` turn remains required to close the installed acceptance observation; historical Gateway messages are not replayed as fabricated human acceptance.

That human-authored turn was observed at 2026-09-18 22:40 KST. Exact addressing succeeded: Tarin alone owned the request and selected `workforce_task_delegate` for Ruen. The next boundary failed, however. The generated task retained only status collection, Ruen returned `answer` with no effect, and Tarin recorded the result as `turn_not_owned`; no requested follow-up action ran. This does not close acceptance. The successor contract preserves the complete human outcome across delegation and marks `task.assignment` and `task.result` with an authenticated opaque task ID and exact coordinator so a status result returns to Tarin for action-or-synthesis instead of ending the mediation chain.

Node distribution `task-coordination-87b60036-r20` (`sha256:87b60036d5f67f182ca4f12d554c9b9927e62dd54e81f684e65f6e6517d90114`) was then installed across all seven services, including Axli. All seven configurations passed preflight and every service was observed `active/running` with zero current restarts. Component acceptance covers complete human-outcome preservation, authenticated assignment/result mapping, exact coordinator ownership, native result correlation, and co-resident result return. One new independently human-authored `@Tarin` mediation turn remains required to prove that the installed chain advances from the worker result to a concrete authorized action or a complete synthesis; the 22:40 message is not replayed after deployment.

The next independently human-authored turn arrived at 2026-09-18 23:18 KST. Tarin alone owned it and delivered authenticated task `tsk_PSg3Q3vUVubLlqkf89Tg` to Ruen. The delivered artifact preserved the exact original inspect-and-act outcome and the concrete route-migration implementation summary. Ruen nevertheless recorded the assignment as `turn_not_owned`: the natural-discussion ownership evaluator treated every non-discussion coordination kind as a negative decision, preventing delegated-task ownership from running. The same protocol-boundary error left one old discussion deadline unowned and regenerated it every two seconds.

Node distribution `coordination-ownership-31c08e7b-r21` (`sha256:31c08e7bb7f6f0a1f9ea0b9891e79b1a92a1e35afabac97ca636fe7a2acfba57`) is installed across all seven services, including Axli. Protocol evaluators now abstain from unrelated coordination kinds, task assignments continue through exact target ownership, task results continue through exact coordinator ownership, and durable discussion deadlines belong only to their stored coordinator. The previously repeating deadline was accepted once, reached a delivered terminal decision, and stopped regenerating. All seven services passed preflight and were observed `active/running` with zero current restarts. One new human-authored mediation turn is still required because the already completed r20 inbox event is not destructively reset or presented as a new human request.

That independently human-authored acceptance turn arrived at 2026-09-18 23:30 KST as event `cve_6b91290ed6ce011d69e5491d92b2c0b511efa88c0879485409f70f668d385cc9`. Tarin alone owned the addressed turn and delivered authenticated task `tsk__tg49mUsz3-tY9mkZYSG` to Ruen. Ruen owned assignment event `cve_1cc07c54d00dd5ba346aa6af9c2ed268a94cdc5902386db2ffa0cdc09d2ac281`, executed one resumed Codex repository-work turn, completed the requested route migration, and recorded 85 passing Chromium checks plus 49 passing SSR route checks. Its `task.result` outbox `cvo_79e6abfa6c061137f31dc4f9e795838aa845e513ac6cf306c04371eb7a756d44` was delivered once to exact coordinator Tarin with the same task ID. Tarin then owned result event `cve_f85f164e4ba5fad3c2c70f2dee70099860f63bbc1c564a4ab1453b219b64812d` and delivered final outbox `cvo_1d1e725f58b67577f7591387e673b5858e5b2d182d41a0d078acae8edb692199` as a reply to the original human message. The final synthesis distinguishes completed implementation and automated verification from the remaining physical-device WebView check and production deployment; neither Ruen nor Tarin output contains HTML comment residue. A separate bot-authored probe also completed the assignment-result-coordinator path but is not counted as human acceptance. All seven r21 services, including Axli, were re-observed `active/running` with zero current restarts after this run.

## Organization and natural hiring

The target organization has one shared general channel for the human owner, central executive, and all repository product owners, plus one project channel per product owner.

Before creating a child workforce identity, the installed natural hiring effect binds the exact product-owner parent, organization deployment, current repository, selected installed role, provider policy, delegation depth, responsibility paths, and capability ancestry. It also binds the child as the active worker for the conversation's next native work turn, with a separate resumable provider session.

For an authorized parent-agent hire, this effect prepares a webhook-backed external speaker and atomically binds it before post-acknowledgement activation. It does not allow cross-team hiring. A central-executive request spanning repository teams and cross-repository formal assignment remain separate bounded effect paths.

## 2026-09-19 fleet deployment

The first shared-worktree Node snapshot was built as immutable Linux distribution `sha256:9167ed156c011c2dcf0170de3b53af00d7ecbf0eddf2f856e90c621f07304c98` and transactionally installed on all seven WSL Node services: Axli, Shiflo, Plen, Flemo, Arca, Digimon, and the acceptance canary. Their service definitions pointed to the same distribution; each service was active and its health process ID matched its systemd main PID. The matching CLI bundle (`sha256:8be52e3c57547edcadfad11a44e6d54834e7d2b57042a416a26312c7f93f72b8`) was installed at a new immutable path, and all seven Node configurations passed preflight with that CLI path. Prior service definitions and CLI configurations remain available for rollback.

The Hub's shared schema and event-contract dependencies also changed, so Hub distribution `sha256:0381dc64939d848fb666fc32becb87737aa91fa35a21e26f536bae4a85ae7d71` was installed and its user service upgraded. Eleven accumulated systemd drop-in files still overrode the newly managed main unit's executable. Their only active settings were historical `ExecStart` replacements; the entire drop-in directory was moved into the owner-only rollback staging area before a daemon reload and restart. The observed process now executes the new Hub distribution, and `/v1/health/ready` returns HTTP 200.

Shiflo, Plen, Flemo, Arca, and Digimon reported overall `ready` with sync, workstream replication, remote control, and conversation ready. Axli reported those same four components ready but overall `degraded` because supervision reported `aggregate_budget_exceeded`; this is not a supervision-readiness success claim. The canary initially reported sync and workstream replication `hub_unavailable`; a controlled rollback to the prior Node distribution reproduced that failure. After the Hub upgrade, the canary's sync and workstream replication became ready, while its standing supervision remained `pending` and overall health `starting` at the last observation. These checks prove process and component health, not the remaining independently human-authored conversation acceptance matrix or a new user-requested runtime action.

## 2026-09-19 explicit-model supervision recovery

The founder approved one additional million tokens for AXLI's existing standing mandate. A reviewed version-2 installation raised its cumulative ceiling from 1,000,000 to 2,000,000 while preserving its exact owner, workstream, paths, capabilities, provider, host, expiry, and attempt limits (installation event `evt_f187ac6a4426fc3f1165e648f15ba47c`). No historical usage was reset. The next AXLI cycle exposed a separate `usage_unobserved` failure: 18 complete Astra runs reported 942,313 tokens and one complete Sol run reported 64,942, with descriptors differing only in requested model. [ADR-0422](../../../../../decisions/execution/orchestration/governed-work/resource-accounting/0422-preserve-supervision-budget-across-model-migration.md) permits a narrowly proven sum for this explicit-model migration. A read-only check against the installed canonical events and CAS descriptors derived exactly 1,007,255 tokens across all 19 runs.

Node distribution `sha256:5993ff78e0590c9d8a1790fefbd54bc27443c9ab6ec32048bed36dfeec0abbb7` and CLI bundle `sha256:fee8b41e2fb862236b88e70ba60bf0f9d7ca2c108be2b20e1606394a6b8fe6e1` replaced the first snapshot on all seven services. All seven configurations passed preflight; all six product-owner Nodes reported overall `ready`, including AXLI supervision. The Hub remained ready on its current distribution. The acceptance canary's conversation, sync, workstream replication, and remote control were ready, but its standing supervision remained `pending` because its latest installed standing-lineage workstream `wks_57cba9746df356647c1d72e3` is not the separately active current review workstream `wks_595331423aaba2b1e67cacfe`. The current review carries a pending operational approval and is not silently completed or rebound by deployment. The canary therefore still reports overall `starting`; this is an explicit installed coordination limit, not a claim that every service is fully ready.

Focused pure budget tests passed on Mac and WSL, typecheck and quality checks passed, and the installed AXLI supervisor reached ready. A wider Mac supervision test run had environment-dependent native-runtime readiness failures and timeouts; it is not counted as passing acceptance. Human-authored Vero preview open/close and the held two-direction conversation matrix remain separate unfinished evidence.

## 2026-09-19 dormant canary readiness correction

The acceptance canary's standing owner is Elio. Its bound lineage remains separate from the current conversation-routing review, whose operational deployment approval is still pending. This is an intentional inactive-owner condition under [ADR-0405](../../../../../decisions/execution/orchestration/governed-work/0405-standing-supervision-lineage.md), not an unfinished process startup. The Node health contract now reports `supervision: dormant` with fixed `reasonCode: workstream_inactive`; aggregate runtime readiness may be `ready` when conversation, sync, workstream replication, and remote control are ready. The fleet status report exposes `conversation` and `supervision` separately, so aggregate readiness cannot be mistaken for an executing supervised goal. Other supervision failures remain `unavailable`.

Focused health and failure-mapping tests passed 12/12 on both Mac and WSL, standing-lineage and change-loop tests passed 6/6 on Mac, typecheck and quality checks passed, and documentation checks passed. Linux Node distribution `sha256:931da383f8b7a89d0a00438ad93b8bb4d8868acc61471d100365764eee83f802` passed all seven configuration preflights and was transactionally activated for the canary first, then the six product-owner Nodes. The final build only treats the exact typed inactive-workstream error as dormant; an unrelated exception carrying the same code remains unavailable. The matching CLI bundle had `dist/bin.js` SHA-256 `75662fc40c4677e1ba60a1ea15f1d3719ffd31f1bbade4d09334f1f11d85d5cf`; all seven owner-only CLI bindings were backed up and changed to its immutable installation, then preflighted and restarted. All seven services remained active with health process IDs matching their systemd main PIDs. All seven installed runtime snapshots and the fleet report were overall `ready`; the canary reported conversation/sync/workstream replication/remote control `ready` and supervision `dormant:workstream_inactive`. Hub readiness remained HTTP 200. The held review stayed active at revision 2 with approval `wapr_e4cd367a01b02a4f`; neither the review, installed mandate, Discord agent identity, nor bot connection was replaced. This corrects the misleading perpetual `starting` status but does not claim that dormant supervision has resumed or that the held conversation acceptance passed.

## 2026-09-23 Shiflo webhook-control correction

A read-only inspection of the current Shiflo interaction stores found twelve `attention_required` outbounds after three `adapter_delivery_failed` attempts: five from Sora and seven from Nuri. All twelve carried `observe_only`; nine also carried `task.result`. None had a platform replay row, so the current webhook adapter's pre-replay rejection of those attributes explains the observed failure without asserting an unavailable historical exception stack. An exact-content-hash poll of the observed channel window found no corresponding publication, but absence from that poll is not a verified delivery receipt or a license to resend. The twelve rows remain unchanged.

Commit `fe023951ee` applies [ADR-0425](../../../../../decisions/coordination/conversations/delivery/0425-separate-webhook-publication-from-task-control.md): unaddressed webhook ingress is observation-only; safe unaddressed webhook status and co-resident task-result text can be published without pretending the webhook carries task control; and a remote task whose source or target cannot carry the bot nonce is rejected before an assignment is posted. Focused adapter, platform, delegation, and co-resident router tests passed 42/42 on Mac and WSL. Typecheck, quality, documentation, build, release-manifest, and SBOM checks passed. The full Mac suite did not pass: its initial 3,955-pass run had generated-metadata mismatches, a no-suite test file, and several timing or file-watch failures. The metadata tests passed after regeneration; two wakeup tests still failed on isolated rerun. Release completion is `intent_pending`, not a published release.

Linux Node distribution `sha256:9b7715bdcc4a74813ad42f6d244d44939d193a5a8d4c45e40e99dcc90e53b2c7` (`runtime-9b7715bd-r55`) was archive-verified, installed immutably, and preflighted against the unchanged Shiflo configuration. Only Shiflo service `nfi_2bbef9a417cbc00263593a8d` was upgraded from r53; its exact r53 definition is retained in the owner-only `webhook-control-r55` acceptance directory. The rendered definition changed only the runtime executable and its private path. At the post-upgrade observation, systemd reported active/running, main PID `2480478`, and zero restarts; the owner-only health snapshot had the same PID and aggregate, conversation, sync, workstream replication, and remote control `ready`. Supervision was separately `dormant:workstream_inactive`. No new human-authored Shiflo turn has yet proved visible webhook publication and exact coordinator continuation after r55. The historical five-plus-seven attention rows remain unresolved, and the two-direction normal/redelivery/failure/retry/restart matrix remains required before technical acceptance is closed. The owner's earlier authorization is not a missing-consent blocker.
