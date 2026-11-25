<!-- lervo-release package="@lervo/cli" version="0.49.0" schema="1" -->

## What's changed

- Read event schema 11 in the CLI, the Node, and the Hub. resource.usage.recorded can carry a hosted ADE session's usage, with cache-creation tokens and a list-price cost; older envelopes refuse that shape. Writer activation stays at schema 10 until every reader has it.
