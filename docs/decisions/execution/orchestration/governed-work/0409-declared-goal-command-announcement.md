# ADR-0409: Declare which deployment announces the goal command

- Status: accepted
- Decision date: 2026-09-16

## Context

[ADR-0405](0405-standing-supervision-lineage.md) lets one installed owner answer `/goal` continuously. The runtime registers that command when the conversation's agent is the installed supervision owner, and registration is guild-scoped: `POST /applications/<application>/guilds/<guild>/commands`.

Only one repository currently has an installed lineage, so exactly one application advertises `/goal` in the shared guild, and every other product owner's channel answers a `/goal` with a scoped rejection. Operators read that as the command belonging to one agent rather than to one repository, and ask which agent they must address to state a goal elsewhere.

The answer is that intake never required the command. An installed owner binds a request through local stdin or its configured Discord speaker, and the slash command is a convenience that normalizes one `goal.requested` event on the same path. Giving another repository its own lineage therefore makes its own product owner accept goals in its own channel.

That is exactly what the current registration rule cannot survive. Guild commands are registered per application, and a deployment can only list its own application's commands, so no node can observe a second installed owner registering `goal` in the same guild. The moment a second lineage is installed, two applications advertise an identical command, neither detects the other, and the operator must pick between indistinguishable entries.

## Decision

A deployment registers the guild-scoped `/goal` command only when `outcomeSupervision.goalCommand.announce` is declared true. The existing conditions still apply: supervised work routing is configured, the guild allowlist is non-empty, and the conversation's durable agent is the installed supervision owner.

An absent declaration announces nothing. It does not reduce authority or intake: the same owner still binds requests from local stdin and from an ordinary addressed message in its own channel, through the same writer, lease, and typed refusals. Announcement is a surface decision about one shared guild namespace, not an authority decision.

A `/goal` invoked outside the announcing owner's configured conversations is still refused without writing, and that refusal now states how the same intake is reached: by addressing the owning product owner in its own channel.

## Consequences

Installing a lineage for another repository no longer creates a second indistinguishable `/goal`. Whoever adds the second lineage decides, in reviewed configuration, whether that deployment advertises the command, and the decision is visible in the launch material rather than inferred from registration order.

The declaration is per deployment because no deployment can see another's registration. This records an operator's choice; it does not detect or resolve a collision, and two deployments that both declare the announcement will both register.

## References

- [Standing supervision lineage](0405-standing-supervision-lineage.md)
- [Installed supervision request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)
