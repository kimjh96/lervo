<!-- lervo-release package="@lervo/ade" version="0.6.0" schema="1" -->

Needs the Lervo CLI 0.43.0 or later.

## What's changed

- A session started right after a Lervo CLI upgrade names itself to the new resident process from its first turn, and an unnamed session's decoder opens again named before its next turn, so its usage is recorded.
- End each finished turn with a quiet summary line that opens to what Lervo recorded about it.
- Place the notice about how the work started under the first message, so it scrolls with the conversation.
- Show each Lervo command the agent runs as a plain sentence of what Lervo did, opening to the exact command.
- Show each tool run as a quiet line that opens to its output or change, and keep an opened line in place.
- Show how many documents an agent's knowledge search found, and the documents when its line opens.
