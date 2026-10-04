# Runtime and natural discussion

## Managed CLI runtime

`cliExecutable` must be an executable Lervo CLI matching the installed Node release. Topics cross the process boundary on stdin; the queue-assigned identity must match the managed result.

Configured `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` pass through the worker boundary to every managed deliberation adapter. When deployment configuration selects an exact provider runtime, an installed service must not fall back to inherited `PATH` or provider defaults.

The Node runtime prepends its executable directory to the child `PATH`, allowing an executable JavaScript CLI with an `/usr/bin/env node` shebang to launch under a restricted systemd environment. Configuration preflight still verifies the exact file and execute permission. Launch and child-process failures are operator evidence; Discord must not present them as canonical-history repair guidance.

## Natural and explicit starts

With `defaultPolicyId` configured, an authorized human can start deliberation with an ordinary explicit request, such as “independently challenge this design and decide whether it is ready.” The semantic resolver supplies the configured policy; users need neither a policy ID nor command syntax.

Retain `/lervo deliberate start <policy-id> -- <topic>` for exact policy selection, diagnostics, and compatibility, and `/lervo deliberate status <deliberation-id>` for inspection. Resume only an authoritatively reconciled interruption.

Natural multi-agent start resolves exact active participation routes and counts distinct real participant runtimes. Fewer than two verified participants yields a bounded reply before queue admission, with no provider call, partial deliberation, policy-seat speaker, or automatic retry. Direct CLI policy execution remains a separate diagnostic and repository decision surface; it does not prove a Discord multi-agent discussion.

## Ordinary cross-Node discussion

The ordinary natural discussion path is separate from the formal policy queue. It selects two exact cross-Node bot peers from the shared conversation and persists both identities in the assignment. Only one explicit active participant owns the first visible assignment.

After recording that content-addressed contribution, the coordinator emits an idempotent assignment whose first visible bot address identifies the remaining participant. Only that normalized exact participant may start the second `review` turn. Before canonical mention sorting, the adapter resolves the ordered native address through its identity port; scheduling never depends on set order.

Each receiver authenticates the source bot and current durable agent binding before using its own role, context, and repository knowledge. This preserves independent review while limiting the installed host to one discussion provider process at a time. The coordinator waits for both contributions, then uses the `reasoning` profile once for final synthesis after the second review releases its provider process.

Discord message text is not the complete control contract:

- A versioned nonce authenticates the coordination kind and opaque discussion ID.
- The identity boundary normalizes the active participant.
- Each Node owns the full persisted envelope and validates source, active target, complete roster, reply, content hash, deadline, automation depth, and idempotency.
- Assignment rendering is bounded to Discord's 2,000-character limit before publication.

The coordinator persists a five-minute deadline. Restart preserves accepted turns without replaying completed provider work. At expiry, one or more verified contributions produce a bounded non-converged synthesis naming missing evidence as risk. Zero contributions produce a fixed terminal reply without another model call. Both paths release the discussion instead of leaving the user with silence.

## User-visible results

The default policy may name internal decision-coverage responsibilities; these names are not Discord identities. Natural start replies contain no policy ID, deliberation ID, artifact count, or wait instruction.

A verified terminal result returns the writing-gated decision body, or the final review if consensus was not reached, to the original conversation. Process stderr and recovery details remain in operator diagnostics.
