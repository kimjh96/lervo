# Independent accepted-result delivery

The explicit Node supervision factory accepts a scoped result-delivery adapter and an exact origin containing source event, policy, target and actor. The accepted-result queue is independent of managed worker execution, performs no model call and never restarts accepted work.

`work.result_delivery.v1` has a version 1 CAS effect containing `schemaVersion`, `kind: work.result_delivery`, workstream and owner IDs, completion plan hash and event ID, accepted result hash, candidate and outbound artifact hashes, and rationale artifact hash. The current completed snapshot and every exact assignment review must still match canonical goal completion. The publication candidate must carry the contextual result writing policy and semantic publication permit for the accepted result's exact bytes. Fixed failure notices cannot substitute for the accepted result. The outbound must retain candidate content and permit and match the configured repository, origin, actor role and adapter integration.

An admitted `publish_result` decision queues immutable publication artifacts under the owner fence. Queueing confirms only the queue effect. The next serialized owner cycle delivers the frozen outbound through the common conversation adapter's idempotency contract, rechecking goal acceptance, current authority and event head before transport.

Failed transport retains the same outbound and publication evidence. At most four attempts are recorded, normally five seconds apart and always before the plan deadline. Restart reloads canonical queue and attempt evidence. Successful delivery requires a schema-valid transport receipt matching outbound and integration; its artifact hash is recorded separately. Response loss after external transport retains the same idempotency key. Operational events exclude provider output, external message IDs, credentials, raw transport errors and target addresses.

Pending delivery supplies a durable next-check time and causes no new owner proposal. Exhausted retries or deadline produce `result_delivery_recovery_exhausted`, leaving canonical work completed. An updated goal does not publish a prior completion's result. Authority revocation stops new sends but cannot undo an initiated transport call. The transport adapter owns its native cancellation and idempotency limits.

The built-worker integration verifies canonical acceptance and completion, exact publication queueing, failed transport, restart, identical outbound retry, one semantic evaluation, unchanged worker prompt log and separate delivered observation. It uses an explicit fixture verdict, evaluator and transport. Startup configuration and installed Discord journeys remain separate acceptance work.

## Native contextual publication

`SupervisedResultDeliveryV2` adds `reasoningPlanHash` and `reasoningResultHash` to the ten V1 fields and maps to `work.result_delivery.v2`. V1 remains available to explicit trusted application integrations. Both versions use existing delivery event payloads and the privacy boundary.

For a completed goal with a configured origin, the native owner recovers the exact admitted completion, snapshot and accepted result bytes. It makes one separately budgeted, read-only `prepare_publication` judgement against the contextual result writing contract, including privacy and every required semantic check. Details contain exactly `resultContentHash`, `writingPolicyId` and `checks`; each check contains `checkId`, `status` and `violationCount`. Completed-workstream reasoning permits only this publication purpose and does not reopen accepted assignments.

The native publication mapper freezes the accepted result, semantic evaluation, permit and outbound in CAS. It preserves the configured origin and limits the current conversation result to 2,000 characters. Canonical admission and transport recovery verify the actual managed reasoning decision, exact terminal result, model evaluator identity and check verdicts, accepted completion coordinates, writing contract, candidate bytes and outbound permit. A substituted result or unverified semantic claim cannot enter the queue.

The native adapter fixture observes five calls and 250 reported tokens from worker execution through contextual publication. A simulated first transport failure and runtime restart reuse the same outbound without another worker or model call. The fixture also rejects a substituted semantic result. Controlled provider replies and transport outcomes do not establish external-model quality or installed Discord acceptance.
