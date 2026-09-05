# Root-agent liveness

`agent.liveness.observed` is a version 2 event containing the root-agent ID and exact current revision, reporting provider, domain-separated provider-session digest, and observation time. It excludes raw provider-session and process identifiers, commands, prompts, output, paths, credentials, and unrestricted errors. Version 1 writers reject it without mutation; recording requires prior explicit version 2 writer activation.

The event proves only that the CLI accepted one report for an active root identity, matching revision, and compatible provider at that time. It does not mutate agent or assignment state or prove caller authentication, continued process health, managed execution, provider understanding, or termination.

The read-only projection reports `unobserved`, `recently_observed`, `stale_observation`, `agent_revision_changed`, or `inactive`. It fails closed on a malformed matching event. Every result declares that it releases no agent authority and proves no managed-process health. Silence and staleness never authorize reassignment, writer takeover, or process replacement.
