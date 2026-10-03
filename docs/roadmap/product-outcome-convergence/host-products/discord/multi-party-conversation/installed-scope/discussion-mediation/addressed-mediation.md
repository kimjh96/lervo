# Installed addressed-mediation evidence

## r19: addressed ownership

The 2026-09-18 `#shiflo` incident exposed two faults:

- Normalized exact `@Tarin` addressing fell back to unaddressed ownership because Tarin was not a project-conversation candidate.
- Ruen's semantic resolver treated any agent mention as a mention of Ruen.

The classifier chose `answer` without an effect and misrepresented its intentionally read-only classification boundary as a read-only installed work runner.

`addressed-mediation-813f3a28-r19`, distribution `sha256:813f3a280007f208abf8f215c872f666bf760f9585a4f98e0699959661097c61`, was installed on all seven services. Tarin has a reviewed binding in every project conversation with unaddressed priority `0`; the local product owner retains `10`. Exact Tarin mentions select Tarin; ordinary project turns stay with the product owner. Missing exact addressees fail closed. Semantic mention context is computed for the responding participant, not from any mention's presence.

After Tarin's durable organization deployment was rebound and synchronization started, all seven services were `active/running` with zero current restarts. Focused ownership, mode, priority, and deployment-configuration suites passed. Acceptance required a fresh independently human-authored project-channel `@Tarin` turn; historical Gateway messages were not replayed as acceptance.

## r20: complete outcome and task correlation

At 2026-09-18 22:40 KST, a human-authored turn selected only Tarin, which chose `workforce_task_delegate` for Ruen. The generated task retained only status collection; Ruen returned `answer` without an effect; Tarin recorded `turn_not_owned`. No requested follow-up action ran, leaving acceptance open.

The successor contract preserves the complete human outcome and marks `task.assignment` and `task.result` with an authenticated opaque task ID and exact coordinator. Status results return to Tarin for action or synthesis rather than ending mediation.

`task-coordination-87b60036-r20`, distribution `sha256:87b60036d5f67f182ca4f12d554c9b9927e62dd54e81f684e65f6e6517d90114`, was installed across all seven services, including Axli. All configurations passed preflight; all services were `active/running` with zero current restarts. Component acceptance covered complete human-outcome preservation, authenticated assignment/result mapping, exact coordinator ownership, native result correlation, and co-resident result return. The 22:40 message was not replayed; a new human turn was required to prove a concrete authorized action or complete synthesis after the worker result.

## r21: coordination ownership

At 23:18 KST, Tarin alone owned the next independently human-authored turn and delivered authenticated task `tsk_PSg3Q3vUVubLlqkf89Tg` to Ruen. The artifact preserved the exact inspect-and-act outcome and concrete route-migration implementation summary. Ruen still recorded `turn_not_owned`: the natural-discussion evaluator rejected every non-discussion coordination kind before delegated-task ownership could run. The same protocol-boundary error left an old discussion deadline unowned and regenerating every two seconds.

`coordination-ownership-31c08e7b-r21`, distribution `sha256:31c08e7bb7f6f0a1f9ea0b9891e79b1a92a1e35afabac97ca636fe7a2acfba57`, was installed across all seven services, including Axli. Evaluators now abstain on unrelated coordination kinds; assignments reach exact target ownership, results reach exact coordinator ownership, and durable deadlines belong only to their stored coordinator. The repeating deadline was accepted once, delivered a terminal decision, and stopped regenerating. All services passed preflight and were `active/running` with zero current restarts. The completed r20 inbox event was not destructively reset or presented as a new human request.

## Human-authored mediation acceptance

At 2026-09-18 23:30 KST, independently human-authored event `cve_6b91290ed6ce011d69e5491d92b2c0b511efa88c0879485409f70f668d385cc9` was owned only by Tarin, which delivered authenticated task `tsk__tg49mUsz3-tY9mkZYSG` to Ruen.

Ruen owned assignment event `cve_1cc07c54d00dd5ba346aa6af9c2ed268a94cdc5902386db2ffa0cdc09d2ac281`, executed one resumed Codex repository-work turn, completed the route migration, and recorded 85 passing Chromium checks plus 49 passing SSR route checks. Its `task.result` outbox `cvo_79e6abfa6c061137f31dc4f9e795838aa845e513ac6cf306c04371eb7a756d44` delivered once to exact coordinator Tarin with the same task ID.

Tarin owned result event `cve_f85f164e4ba5fad3c2c70f2dee70099860f63bbc1c564a4ab1453b219b64812d` and delivered final outbox `cvo_1d1e725f58b67577f7591387e673b5858e5b2d182d41a0d078acae8edb692199` as a reply to the original human message. The synthesis separates completed implementation and automated verification from the remaining physical-device WebView check and production deployment. Neither speaker's output contained HTML comment residue.

A separate bot-authored probe completed the assignment/result/coordinator path but is not human acceptance. All seven r21 services, including Axli, were re-observed `active/running` with zero current restarts after this run.
