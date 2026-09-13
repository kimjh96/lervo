# `agent.liveness.observed`

Retains the root-agent ID and exact revision, reporting provider, domain-separated provider-session digest, and observation time. Excludes the raw provider session, process ID, command, prompt, output, path, credential, and unrestricted error. Recording requires an explicitly activated v2 writer.

The event represents one accepted report, not continued provider-process health or authenticated process identity. Missing, old, or revision-mismatched evidence grants no authority and never releases an agent, assignment, or workspace writer.
