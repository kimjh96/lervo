# `ProductDeliberationViewV1`

## Required fields

The view requires:

- `schemaVersion: 1` and `kind: product_surface.deliberation`;
- deliberation, project, policy ID, and policy-hash coordinates;
- nullable source event, conversation, thread, requester, and origin-binding digest, with all origin fields populated together for a bound record;
- source event-head hash and repository revision;
- current status, round, maximum rounds, next action, and terminal reason;
- ordered participant bindings, artifact summaries, verification entries, and unresolved objections;
- resource-report, publication, and origin-delivery coordinates; and
- an exact projection digest.

## Participant bindings

Each participant binding includes its policy role and responsibility, provider policy, nullable durable participant, agent, and exact semantic role-version coordinates. Its disposition is `hired_agent` or `policy_only`.

## Artifact summaries

Each artifact summary includes artifact kind, round, producer role, provider, run and session coordinates, content hash, predecessor coordinates, writing-permit status, and bounded claim, objection, verification, or decision coordinates.

Authorized bodies are loaded separately through current source inspection.

## Projection status and validity

Projection status is `complete`, `partial`, `unavailable`, or `invalid`.

Missing optional resource observations produce `partial` or `unavailable`; the projection must not fabricate a zero. Invalid policy, history, participant, artifact, origin, or delivery coordinates make the affected section `invalid`. Contradictory authority or history fails the whole view.

Legacy missing origin, structured-artifact, or reconstructable-outcome sources produce `unavailable` with a specific reason code. Required view properties remain present with nullable origin coordinates or bounded empty summaries, so a host can distinguish missing evidence from a transport failure. The projector accepts an empty artifact list as complete only when the source reader explicitly reports `complete`.

## Exclusions

The projection excludes the topic body, prompts, reasoning, provider conversations, raw outputs, credentials, native platform identifiers, unrestricted paths, and hidden evaluator payloads. A bounded display title or excerpt requires current source authorization and is not durable telemetry.

## Host-neutral projector

`@lervo/product-surface-projection` accepts a complete, source-bound deliberation projection input and emits `ProductDeliberationViewV1`. It reuses the provider-neutral deliberation history and outcome validators instead of interpreting agreement in presentation code. Proposal, objection, revision, verification, and decision summaries retain their exact artifact, role, provider, run, session, content-hash, predecessor, claim, objection, and verification coordinates. Artifact bodies remain outside the view.

The projector derives policy-only participants from the selected policy. A hired-agent binding is used only when its role exists in that policy and its workforce provider policy can satisfy the participant provider selection. A contradictory binding or history produces an `invalid` projection. Missing resource evidence produces `partial`, never zero usage. Terminal publication and origin delivery remain independently partial until their coordinates exist.

`readDeliberationArtifactEvents` reads a bounded event snapshot before projection. It returns `complete` only when every artifact event carries a schema-valid structured artifact whose project, deliberation, artifact, kind, round, producer role, provider, run, session, content, permit, and timestamp coordinates agree with its envelope and summary. A legacy summary-only event makes the structured history `unavailable`; the reader returns no partial artifact list. Duplicate or contradictory coordinates make it `invalid`. Markdown bodies are never loaded by this reader.

`readDeliberationOutcomeEvent` keeps a history active when no terminal event exists. For one terminal event, it reconstructs the possible version-1 outcomes from the policy, complete artifact history, verification evidence, event timestamp, and bounded terminal fields, then accepts exactly one candidate through the core outcome validator and recorded outcome ID. Duplicate terminal events, an invalid payload, a non-system actor, a project mismatch, zero matching outcomes, or ambiguous matching outcomes are `invalid`. Presentation code does not infer consensus or failure semantics.

`readDeliberationVerificationEvents` joins each structured verification artifact to exactly one canonical `verification.completed` event, the content-addressed result artifact, and the current suite source. Project, run, session, verification, suite, result-artifact, result-hash, and status coordinates must agree. A missing event, artifact, or suite is `unavailable`; duplicates, invalid bytes, or contradictory coordinates are `invalid`.

`projectDeliberationApplicationView` composes the three readers with the validated queue status and origin, participant bindings, exact event head and repository revision, and independently supplied resource, publication, and delivery coordinates. It propagates source dispositions into the view before calling the pure projector. A terminal queue summary without a reconstructable validated outcome remains `unavailable`; a terminal event that contradicts the queue summary is `invalid`.

`readDeliberationPolicyEvent` restores the complete provider-neutral policy from a new start event and verifies its project, policy ID, hash, participant order, and round bound. A predecessor hash-only event remains valid but reports the embedded policy as unavailable. The installed reader may use the current repository policy only when it recreates the recorded hash exactly.

## Installed-route gate

Protocol discovery must not advertise a deliberation query until an application composition can supply all required canonical sources. New conversation deliberation jobs preserve an immutable Lervo conversation, nullable thread, requester, source event, and origin-binding digest. New artifact events preserve the complete validated structured artifact alongside their original bounded summary coordinates, without the Markdown body. Legacy queue rows and artifact events remain readable with those additions absent, and exact CLI deliberations still have no conversation origin by design.

The host-neutral application projector and installed CLI reader now join these sources through product-host protocol v11. Queue and interaction databases are opened read-only with current schema and integrity checks; neither query migrates, leases, settles, accepts, or delivers work. The reader rechecks mutable queue and delivery sources and the repository revision before returning. Legacy omissions remain explicit, policy participants are never invented as hired agents, and conversation-wide fallback notification never becomes origin delivery.

This route is a query boundary, not installed Discord acceptance. The packed CLI consumer now provides installed host-neutral conformance for both a live origin-bound running deliberation and a failed terminal deliberation reconstructed from a validated core outcome: it verifies protocol-v11 discovery, exact source/conversation/thread/requester binding, policy-only participant projection, explicit partial resource meaning, the terminal reason and next action, and exclusion of the private topic and prompt fields. That fixture does not claim structured-artifact, publication, or delivery acceptance, and it does not substitute for a converged or no-consensus journey. The Node reference composition now projects newly recorded, structurally validated, writing-gated proposal, objection, revision, verification, and decision summaries into the bound Discord thread. It uses deterministic conversation-event identity, the durable interaction outbox, and adapter replay, and does not load the Markdown body or spend another provider turn. First enablement checkpoints the current repository-event head, legacy records without an origin are not projected, and zero or multiple responding policies fail before cursor advancement. A real installed Discord positive journey remains required before the product capability is complete; the production negative journey has separately proven that a peer-agent suggestion cannot start formal deliberation without an authorized human request.
