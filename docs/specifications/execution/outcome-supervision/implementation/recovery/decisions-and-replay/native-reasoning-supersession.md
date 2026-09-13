# Native owner reasoning supersession

Native owner reasoning uses a fenced absence path. Its adapter reserves the deterministic execution identity before any provider call. Supersession requires:

- No events at all for that identity.
- A changed canonical task or authority source, excluding the decision's own records.
- Current installed authority.
- An unchanged event head.
- A current owner fence.

Recording a pending decision alone cannot justify replacing it. A reservation without later events remains uncertain.

The version-2 `work.effect_absence` CAS inspection contains exactly `schemaVersion`, `kind`, `effectContract`, `decisionId`, `planHash`, `effectHash`, `sourceRevisionDigest`, `runId`, `sessionId`, `runEventsAbsent`, `eventHeadHash`, and `observedAt`.

Supersession uses the existing envelope-version-3 `work.supervision.decision.superseded` event with unchanged payload and privacy rules. No prompt, source text, path, credential, or provider output enters the event or inspection.

Historical reasoning and resource admission validate the same exact absence evidence before excluding the unstarted decision from attempt counts and reservations. They reject contradictory run events. Restart can then form a new decision over the changed source without replaying the abandoned provider effect.

Tests cover changed staffing, restart, reservation-only uncertainty, lost fences, and unchanged-source rejection. They do not establish safe retry of a dispatched worker.
