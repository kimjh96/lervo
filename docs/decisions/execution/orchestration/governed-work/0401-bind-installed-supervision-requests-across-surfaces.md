# ADR-0401: Bind installed supervision requests across local and Discord surfaces

- Status: accepted
- Decision date: 2026-09-13

## Context

An installed owner previously selected its mandate and workstream at startup while Discord `repository_work` started a separate native provider turn. Neither path wrote `work.supervision.bound`. A conversation-local duplicate record could not establish common goal admission or assignment ownership. A static result origin also tied publication to one preselected Discord event.

## Decision

When a Discord speaker is the exact installed supervision owner, `repository_work` enters the supervision request intake instead of starting a native repository-work provider. The local `lervo-node supervise --config ... --request-stdin` option enters the same intake. Existing deployments without that owner binding retain native repository work. Both sources use the installed owner lease, current mandate, active workstream, current assignment graph, and one canonical `work.supervision.bound` event. The source ID and requester are hashed in the event-backed artifact; raw request text and the exact conversation origin remain in local CAS, not event payloads. Replaying the exact source returns its event without a second admission. A different source cannot silently replace the origin of an already bound goal.

The native owner reads the bound request as part of its canonical reasoning facts. For a Discord-bound goal, result publication uses that exact authenticated source event, policy, target, and speaker. The adapter still verifies integration and accepted result evidence. Local requests have no external delivery origin; their accepted result remains in canonical local workstream and artifacts. A configured static result origin remains supported for older installed flows and must match an incoming supervised Discord request exactly.

Request binding proves admission to the current reviewed goal, not provider start, task completion, or user delivery. An expired or revoked mandate, changed workstream, occupied owner lease, conflicting source, invalid origin, or failed event write leaves the request unadmitted. The existing outcome controller, effect preflight, resource accounting, review, and delivery gates remain authoritative.

## Consequences

Local and Discord can now address one installed owner and assignment set without converting a conversation into managed-run evidence. New goal creation, amendments, multiple result recipients, production permission repair, and deployment activation remain separate reviewed transitions. Native repository work remains available where no installed owner is configured.

## References

- [Installed request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)
- [Native repository work admission](../../../../specifications/coordination/native-repository-work-admission.md)
