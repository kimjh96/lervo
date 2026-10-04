# Repository upgrade role bindings

Repository upgrade refreshes a stale shipped built-in agent with `agent.identity.changed` and `changeKind=role_binding`. Refreshing a repository-defined role binding requires the current plan's exact per-role operation ID and approval hash.

Each stale assignment refresh emits `assignment.role.binding.changed`, requiring `assignmentId`, previous and next role version, role contract hash, required capability hash, `roleId`, and `revision`.

A required capability hash changes only when it exactly matches one stale agent binding with one unambiguous replacement. Repository-role approval changes generated binding records only; it never rewrites `.lervo/roles`.

The event excludes task text, role prose, source paths, capability bodies, provider configuration, and credentials.

Event rejection restores the individual state file. Interruption may leave earlier records refreshed; the next content-bound plan resumes only the remaining records. No wrapper event claims whole-stage completion.
