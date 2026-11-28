<!-- lervo-release package="@lervo/cli" version="0.69.0" schema="1" -->

## What's changed

- A hosted conversation leaves out Claude Code's ToolSearch calls, which only load tool definitions, and names what a Monitor call watches and whom a SendMessage call addresses.
- An agent can hand work to the teammate whose work it is, as a conversation that teammate leads and writes in, with lervo workspace start --lead; an agent that joined a conversation can start one too, and the hourly start guard rises to 12 as a backstop.
- Background knowledge review no longer stops when a project has more than eight owner rules; instructions are bounded by bytes and low-ranked recommendations give way first.
- CAS retention skips the event channel's pipes, names the path that stops it in application attention, reads a changing file again within the cycle, and leaves a tombstone so a pruned object reads as pruned.
- Comments and documents cite the byte-bounded review context decision as ADR-0659, which had collided with another ADR-0657.
- Lervo agent inspect reports a child agent with its root agent's liveness instead of refusing it.
- Lervo restores a project checkout that Git reads as bare, such as after a hook's test ran git init against it, instead of resolving an empty coordination home that hides the team.
- Lervo upgrade removes every superseded event writer backup at once and keeps only the rollback point, instead of keeping each one for 14 days.
- lervo workspace send hands work to a conversation a teammate already leads, delivered to its lead when the sender's turn ends, and a lead whose session stopped resumes as the conversation's own session to receive it.
- room.answers leaves out answers in conversations the lead itself leads and finds the lead by its writing record, so a product owner's conversations stop repeating a line for each turn of the others.
