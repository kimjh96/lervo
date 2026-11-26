<!-- lervo-release package="@lervo/cli" version="0.63.0" schema="1" -->

## What's changed

- An agent can have an image: lervo agent mark sets or clears it, the core link offers agent.mark.set, clear, and read, and agents.list reports it; the image is stored once by its hash.
- Check event payload coordinates through one table keyed by event type instead of a chain of type comparisons; accepted and refused payloads are unchanged.
- lervo agent dispatches each action through a table of handlers; every action behaves as before.
- Lervo keeps a private claim log of the writes it refuses or defers in ADE conversations, and the conversation shows who holds a stopped path and when a turn's claims wait for its end.
- Lervo names the context source bound once in the event contract that records it, and the role input bound once beside its binding event; values are unchanged.
- Let ADE conversation assignments start without paths and widen their live lease by claims, with one core path conflict judgment shared by every claim.
- Opening a conversation in the ADE no longer moves it to the top of the list: the list orders by when a conversation began or an agent joined it, and a reopen keeps that time.
- The core link answers agent.context: an agent's active learned context entries, newest first, with their words, for the ADE's agent profile.
