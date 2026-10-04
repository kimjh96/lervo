# Request binding contract

Local stdin and the configured Discord speaker share Node intake under the exclusive owner lease, binding one request to the active installed owner's current workstream.

## Admission and artifacts

Before appending `work.supervision.bound`, the writer checks the current mandate, workstream revision, assignment graph and latest event hash. The event records supervision, owner, mandate, workstream revision, graph hash, snapshot cause, request artifact hash and acceptance artifact hash. It excludes request text, external message IDs and participant IDs.

The request artifact stores bounded text, source kind, source and requester digests, content hash and, for Discord, an exact result origin. Writer and reader verify the text digest; the reader also verifies the Discord source digest against the bound source event.

New Discord bindings use version-two request artifacts with a snapshot of at most twelve prior conversation turns from the exact target and thread: the last eight eligible turns plus up to four earlier human anchors. Eligible inbound turns must be completed by intake and have an earlier platform event time; outbound replies must have been delivered before the new ingress time. Each source record and CAS excerpt has an exact hash. Owner reasoning verifies those source rows and bytes on every read. Text and participant identity remain private in local CAS and never enter the binding event. Legacy version-one artifacts remain readable without invented history; local stdin bindings remain version one.

Version two requires `conversationContext`. Each turn requires:

- `role` and bounded `text`.
- `speaker`: `kind`, `participantId`, nullable `agentId` and `roleId`.
- `source`: `kind`, `id`, `roleId`, `recordHash`, `contentHash`, `observedAtMs`.

`source.kind` is `inbound` for user turns and `outbound` for assistant turns. Malformed or over-bound context returns `request_invalid` before binding. Missing or conflicting persisted sources fail owner reasoning closed without an effect or publication; they must not become empty history or be repaired from later conversation state.

The acceptance artifact pins the workstream objective, snapshot and assignment IDs at admission. The reader reconstructs assignments from creation events before the binding sequence, independently of wall-clock timestamp ties. Both artifacts use local CAS.

An exact replay of the same source and content returns the existing event. A changed source or second origin for that goal fails closed. A failed or unobserved commit does not authorize replaying a provider effect.

Replay compares the authenticated request and origin, not a recomputed conversation window. The first successful binding's context snapshot is immutable: delayed retries cannot change earlier meaning or introduce later turns.

## Refusals and uncertainty

A typed refusal supplies one bounded code and writes nothing: `request_invalid`, `identity_conflict`, `workstream_inactive`, `origin_conflict`, `authority_changed`, `evidence_changed`, or `owner_busy`. Any other failure is uncertain because the commit may have happened.

The owner loop holds its fence for a whole cycle. Admission polls that fence until its deadline: 30 seconds for local stdin and 120 seconds for a Discord speaker, covering about two idle owner cycles. Expiry returns `owner_busy` without an event, artifact or provider effect.

An installed journey observed the earlier 30-second Discord deadline expiring four seconds before the owner released its idle cycle. The request was refused although the goal had no request.

## Mandate and workstream continuity

An approved successor mandate retains the original request and result origin. The writer replays the exact source, requester and content against the original binding without adding an event. Before accepting a binding under an earlier mandate, the reader validates installed mandate history for the same supervision, workstream and owner. An unrelated mandate or later installation cannot supply the request origin.

Binding an unrelated request to an existing objective is not a goal amendment. A new objective, revised acceptance criteria or additional recipient requires a separate workstream and authority transition.

After the original workstream is settled and completed, a successor may start with a new ID and exact predecessor hash. This preserves the prior local or Discord source binding while giving a later request a distinct goal identity. The successor requires its own reviewed mandate and installed owner binding; succession alone grants no execution or publication authority.

## Results and acceptance

The immediate response proves only canonical binding. The natural intake response identifies admission to the current installed goal, not creation of an unrelated goal.

Local `--request-stdin` keeps request text out of process arguments and runs the same owner loop after binding. Local results remain canonical without external publication.

Installed production acceptance must observe real ingress, the owner cycle, permission recovery, the accepted result and delivery under settled authority.
