<!-- lervo-release package="@lervo/cli" version="0.65.0" schema="1" -->

## What's changed

- A prompt's recorded context counts the owner rules Lervo prepared for the turn once the repository's writer selects event schema 15, and turn.summary reports them.
- After a turn another agent's mention delivered, the agent keeps a conversation note of what it said, attested by the delivery's receipt, once the writer selects event schema 16.
- An agent's context accepts a conversation note that its own delivery receipt attests (ADR-0648), instead of refusing the agent's whole context.
- An agent's session starts with its own three newest conversation notes, labeled as notes it wrote itself.
- Gate conversation coordination on the host hook runtime, retire conversation leases and records, narrow convergence holds, and report held stages as Lervo debt
- lervo upgrade activates event schema 16 once every reader reads it, and holds a host whose hook runtime an older Lervo install published
- Return knowledge query rules when recorded verification evidence cannot be verified, and report what was left out.
- Rooms record who mentioned whom, each delivery, an agent's joining, and a paused exchange as schema-15 events in the conversation's repository, once its writer selects schema 15.
- Terminal skill telemetry now reads Claude Code transcripts from the directory CLAUDE_CONFIG_DIR names, instead of refusing them as outside the provider's directory.
- The core answers room.answers: the mentions a conversation's lead answered in other conversations, from the rooms' schema-15 records.
