# Installed discussion and addressed-mediation evidence

## Natural discussion

The final controlled General-channel run on 2026-09-18 used `real-agent-discussion-8c6abe2c-r18`, distribution `sha256:8c6abe2c577d093c4830397f523c06162d76a01fc52459cf3da0635f45cb5a8d`, across all seven installed services.

| Step | Discord message |
| --- | --- |
| Source | `1550448628802396242` |
| First assignment | `1550448735580983322` |
| Lumi contribution | `1550448948802625577` |
| Serialized second assignment | `1550448950610497601` |
| Miro contribution | `1550449123147124849` |
| Tarin synthesis | `1550449257402597398` |

Discussion `dsc_shHsAv739vvc0lzSBrHw` records exactly two distinct contribution bindings and terminal `discussion.converged`. Receiver inboxes reconstruct `assignmentSequence: 1` with active participant Lumi and `assignmentSequence: 2` with active participant Miro.

The single synthesis identifies participant and durable agent IDs separately, scopes product writing rules and historical workstream reports rather than treating them as shared current facts, and states that comparison and final decision completed. Every observed message came from its installed application bot, had no webhook ID, and contained no HTML comment residue. All seven services, including Axli, used the same immutable r18 runtime and were active with zero service restarts after deployment.

Earlier r15 discussion `dsc_Yhgah_fxU3JPYiSTzCal` converged with Sera and Axli's Vero as distinct durable contribution bindings. This proves Axli participated in the protocol, beyond merely running the bundle.

These controlled sources used an existing application-bot credential; they are not independently human-authored acceptance messages. They prove the installed serialized receiver-owned discussion path and fixes for publication-contract, ownership, nonce-collision, speaker-attribution, and stale-status failures. The broader normal/redelivery/failure/retry/restart matrix remains a separate operational gate.

## Addressed mediation: r19

The 2026-09-18 `#shiflo` incident exposed two faults: normalized exact `@Tarin` addressing fell back to unaddressed ownership because Tarin was not a project-conversation candidate; Ruen's semantic resolver treated any agent mention as a mention of Ruen. The classifier chose `answer` with no effect and misrepresented its intentionally read-only classification boundary as a read-only installed work runner.

`addressed-mediation-813f3a28-r19`, distribution `sha256:813f3a280007f208abf8f215c872f666bf760f9585a4f98e0699959661097c61`, was installed on all seven services. Tarin has a reviewed binding in every project conversation with unaddressed priority `0`; the local product owner retains `10`. Exact Tarin mentions select Tarin; ordinary project turns stay with the product owner. Missing exact addressees fail closed. Semantic mention context is computed for the responding participant, not from any mention's presence.

After Tarin's durable organization deployment was rebound and synchronization started, all seven services were `active/running` with zero current restarts. Focused ownership, mode, priority, and deployment-configuration suites passed. A fresh independently human-authored project-channel `@Tarin` turn was required; historical Gateway messages were not replayed as acceptance.

## Human turns and r20–r21 corrections

At 2026-09-18 22:40 KST, a human-authored turn selected only Tarin, which chose `workforce_task_delegate` for Ruen. The generated task retained only status collection; Ruen returned `answer` without an effect; Tarin recorded `turn_not_owned`. No requested follow-up action ran, so acceptance remained open.

The successor contract preserves the complete human outcome and marks `task.assignment` and `task.result` with an authenticated opaque task ID and exact coordinator. Status results return to Tarin for action or synthesis rather than ending mediation.

`task-coordination-87b60036-r20`, distribution `sha256:87b60036d5f67f182ca4f12d554c9b9927e62dd54e81f684e65f6e6517d90114`, was installed across all seven services, including Axli. All configurations passed preflight; all services were `active/running` with zero current restarts. Component acceptance covered complete human-outcome preservation, authenticated assignment/result mapping, exact coordinator ownership, native result correlation, and co-resident result return. The 22:40 message was not replayed; a new human turn was required to prove a concrete authorized action or complete synthesis after the worker result.

At 23:18 KST, Tarin alone owned the next independently human-authored turn and delivered authenticated task `tsk_PSg3Q3vUVubLlqkf89Tg` to Ruen. The artifact preserved the exact inspect-and-act outcome and concrete route-migration implementation summary. Ruen still recorded `turn_not_owned`: the natural-discussion evaluator rejected every non-discussion coordination kind before delegated-task ownership could run. The same protocol-boundary error left an old discussion deadline unowned and regenerating every two seconds.

`coordination-ownership-31c08e7b-r21`, distribution `sha256:31c08e7bb7f6f0a1f9ea0b9891e79b1a92a1e35afabac97ca636fe7a2acfba57`, was installed across all seven services, including Axli. Evaluators now abstain on unrelated coordination kinds; assignments reach exact target ownership, results reach exact coordinator ownership, and durable deadlines belong only to their stored coordinator. The repeating deadline was accepted once, delivered a terminal decision, and stopped regenerating. All services passed preflight and were `active/running` with zero current restarts. The completed r20 inbox event was not destructively reset or presented as a new human request.

## Human-authored mediation acceptance

At 2026-09-18 23:30 KST, independently human-authored event `cve_6b91290ed6ce011d69e5491d92b2c0b511efa88c0879485409f70f668d385cc9` was owned only by Tarin, which delivered authenticated task `tsk__tg49mUsz3-tY9mkZYSG` to Ruen.

Ruen owned assignment event `cve_1cc07c54d00dd5ba346aa6af9c2ed268a94cdc5902386db2ffa0cdc09d2ac281`, executed one resumed Codex repository-work turn, completed the route migration, and recorded 85 passing Chromium checks plus 49 passing SSR route checks. Its `task.result` outbox `cvo_79e6abfa6c061137f31dc4f9e795838aa845e513ac6cf306c04371eb7a756d44` delivered once to exact coordinator Tarin with the same task ID.

Tarin owned result event `cve_f85f164e4ba5fad3c2c70f2dee70099860f63bbc1c564a4ab1453b219b64812d` and delivered final outbox `cvo_1d1e725f58b67577f7591387e673b5858e5b2d182d41a0d078acae8edb692199` as a reply to the original human message. The synthesis separates completed implementation and automated verification from the remaining physical-device WebView check and production deployment. Neither speaker's output contained HTML comment residue.

A separate bot-authored probe completed the assignment/result/coordinator path but is not human acceptance. All seven r21 services, including Axli, were re-observed `active/running` with zero current restarts after this run.
