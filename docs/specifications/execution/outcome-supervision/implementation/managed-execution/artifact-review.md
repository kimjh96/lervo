# Canonical owner artifact review

The explicit Node owner session records an owner's verdict on one returned assignment through `work.artifact_review.v1`. This effect persists an existing judgement; it does not invoke a model, infer semantic acceptance from tests, complete the workstream, or publish a response.

## Exact decision and evidence

The version-1 CAS effect contains `schemaVersion`, `kind: work.artifact_review`, assignment ID and revision, responsibility artifact hash, terminal event ID, reviewer agent ID, acceptance hash, result artifact hashes, verification event IDs, verdict, and rationale artifact hash. Verdicts are `accepted`, `rework`, and `blocked`. The rationale is a nonempty JSON string in governed CAS. Review and rationale artifacts retain the supervision artifact's 256 KiB bound; result and verification loading retain their existing bounds.

An admitted `execute_as_owner` decision must bind the exact effect, responsibility, rationale, and owner. The journal verifies its stored plan and policy review and requires the result terminal event to precede the decision. Acceptance additionally requires a reconciled completed assignment, its exact current artifact set, and passed references for every required verification suite. Missing verification, another reviewer, another result, changed responsibility, or a later assignment revision cannot establish acceptance.

The Node session uses canonical task observations, not caller-supplied task status. It checks the combined authority/task digest and graph, reobserves sources after loading artifacts, and checks the event head and deadlines inside the owner-fenced event transaction. A concurrent assignment revision can invalidate the recorded basis; later observation must still match that revision before recognizing acceptance. The operation neither mutates assignment files nor claims a transaction spanning filesystem and event storage.

## Persistence and recovery

The existing envelope-version-3 `work.supervision.review.recorded` payload remains unchanged. Its causal references identify the recorded owner decision and returned terminal event; its deterministic event identity derives from that decision. Raw rationale, paths, provider output, and user-facing response text remain outside the event.

Exact repeated recording is idempotent. A read-only inspector recovers the plan, policy, rationale, and expected event across database connections. Lost ownership, changed authority, stale sources, corrupt artifacts, or inconsistent event bytes reject the write or observation. The generic decision journal permits this narrowly decision-bound review event as effect evidence. A decision cannot confirm itself; other supervision records do not become execution evidence.

A bare review event without its exact admitted decision does not establish task acceptance. Current `blocked` reviews route `acceptance_blocked` to a bounded owner decision instead of indefinitely requesting the same review. The orchestrator maps only the exact `work.artifact_review.v1` control effect from that reason to `execute_as_owner`; unknown contracts remain blocked, and ordinary admission and readiness still apply. The owner may record a separate review of the same artifact only when newly available exact canonical evidence resolves the recorded blocker; otherwise it escalates. A stale blocked review does not block a different result.

## Admission and readiness

The canonical Node runtime routes this exact control effect through built-in task admission and a five-second owner-control readiness observation. It checks the active owner's role/provider, exact effect fields, current responsibility and result basis, rationale, event head, and authority/task digest. A provider declaration of `any` still requires an allowed concrete provider. Recording needs no worker lease or provider start. Native owner reasoning has separate provider admission; ordinary worker execution still requires worker readiness.

Known exact topology, review, goal-completion, and result-delivery controls do not become provider attempts. Their bounded V1 token reservation remains outstanding until effect confirmation. Unknown contracts or missing actual provider usage remain unobserved. Internal control records cannot manufacture zero usage or free another provider reservation.

The built-worker integration uses real canonical admission and normalized provider counters. A reported 50-token fixture run can proceed to review; an otherwise successful run without reported usage remains budget-blocked. The integration then verifies [canonical goal completion](goal-completion.md) and [independent delivery](../result-delivery.md). The owner verdict and publication evaluator are explicit fixture inputs. Grounded production model decisions and installed acceptance remain open.
