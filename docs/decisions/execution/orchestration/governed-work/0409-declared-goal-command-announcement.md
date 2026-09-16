# ADR-0409: Declare which deployment announces the goal command

- Status: superseded by [ADR-0410](0410-intent-routed-supervision-goal-intake.md)
- Decision date: 2026-09-16

## Context

[ADR-0405](0405-standing-supervision-lineage.md) lets one installed owner answer `/goal` continuously. The runtime registers the command when the conversation's agent is the installed supervision owner, using the guild-scoped endpoint `POST /applications/<application>/guilds/<guild>/commands`.

Currently, only one repository has an installed lineage, so one application advertises `/goal` in the shared guild. Every other product owner's channel returns a scoped rejection. Operators interpret the command as belonging to one agent rather than one repository and ask which agent to address for goals elsewhere.

Intake does not require the command. An installed owner binds requests through local stdin or its configured Discord speaker; the slash command is a convenience that normalizes one `goal.requested` event on the same path. Installing another repository's lineage lets its product owner accept goals in its own channel.

The registration rule cannot support this without ambiguity. Guild commands are registered per application, and each deployment can list only its own application's commands. A second installed lineage therefore produces two indistinguishable `goal` commands in the shared guild; neither deployment can detect the other, leaving the operator to choose.

## Decision

A deployment registers the guild-scoped `/goal` command only when `outcomeSupervision.goalCommand.announce` is declared true and all existing conditions hold: supervised work routing is configured, the guild allowlist is non-empty, and the conversation's durable agent is the installed supervision owner.

An absent declaration announces nothing. Authority and intake remain unchanged: the owner still binds requests from local stdin and ordinary addressed messages in its own channel through the same writer, lease, and typed refusals. Announcement controls a surface in the shared guild namespace, not authority.

A `/goal` invocation outside the announcing owner's configured conversations is refused without writing. The refusal explains how to reach the same intake: address the owning product owner in its own channel.

## Consequences

Installing another repository's lineage no longer automatically creates a second indistinguishable `/goal`. Whoever adds the lineage decides in reviewed configuration whether that deployment advertises the command. Launch material makes this choice visible instead of leaving it implicit in registration order.

The declaration is per deployment because deployments cannot see each other's registrations. It records an operator choice without detecting or resolving collisions: two deployments that declare announcement both register.

## References

- [Standing supervision lineage](0405-standing-supervision-lineage.md)
- [Installed supervision request intake](../../../../specifications/execution/outcome-supervision/implementation/node-composition/installed-startup/request-intake.md)
