<!-- lervo-release package="@lervo/cli" version="0.56.2" schema="1" -->

## What's changed

- Answer a served non-worker Stop before its records, and relay launches the records ask for to the provider's session through a detached relay the client leaves behind.
- Read the boot identity once per process, take a Stop's HEAD from its lifecycle snapshot, and start the newest-workstream read with a small page, trimming repeated work from every Stop.
- Report each served hook's answer latency by kind in context-stats.json, so a canary sees what the provider waited for apart from the records that follow.
