# Failed observations and changed sources

## Stop and settlement

A recorded `adapter.stopped` acknowledgement carries the requested termination reason. `failed` or `cancelled` alone does not mean the stop operation failed. The reader requires one consistent stop before one terminal event.

A fully recorded failed read-only observation can settle without accepting a business result. A missing or contradictory stop remains uncertain.

## Retry and usage

A later owner attempt uses the existing work ID and ordinary retry ancestry, with the prior run as its parent and retry source. The attempt sequence remains bounded by the same context basis and mandate.

Complete provider-reported usage is required before another invocation. Missing usage blocks new admission rather than counting the failed call as zero. The native failure fixture verifies retry after restart with two calls and one hundred reported tokens; its missing-usage variant admits no second call.

## Changed sources

A valid stored context whose current source bytes changed returns a typed stale-source result, allowing fresh reasoning within the bound. Stored source text must first match its recorded hash. Corrupt artifacts and malformed evidence are not ordinary source changes.

## Expired plans without invocation

An owner plan can expire before the native provider adapter is invoked. Exact proof of zero events for its deterministic run permits a current fenced owner to supersede it when the source changed or the plan deadline expired. A reservation, requested run, or any other event prevents recovery. The old plan, artifacts, usage, and decision remain canonical; supersession resets no budget and grants no result acceptance.

The version-six `work.effect_absence` artifact retains the version-two identity fields and adds required `invalidatedBy`, either `source_changed` or `deadline_expired`. The latter requires `observedAt` at or after the exact plan deadline. Required fields are `schemaVersion`, `kind`, `effectContract`, `decisionId`, `planHash`, `effectHash`, `sourceRevisionDigest`, `runId`, `sessionId`, `runEventsAbsent`, `eventHeadHash`, `observedAt`, and `invalidatedBy`. Version-two source-change evidence remains readable.

The existing `work.supervision.decision.superseded` event references this governed CAS artifact. Its bounded identifiers, hashes, timestamps, and reason disclose no prompts, paths, or provider output. Before append, the recorder rechecks the live mandate, current owner fence, unchanged event head, five-second evidence age, and absence of every run event. Recovery readers reject late run events. Missing, changed, expired, or contradictory proof retains the pending decision as uncertain. Deploy compatible readers before writing version-six evidence.
