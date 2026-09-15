# Installed supervision configuration

Node configuration may include one `outcomeSupervision` object with required fields `runtimeReadiness`, `ownerReasoning` and `managedExecution`, exactly one of `binding` or `standing`, and optional `resultOrigin`.

The binding names an already installed supervision ID, workstream, owner and mandate hash. Configuration selects that exact authority; it cannot install a mandate, approve a plan or widen scope. `standing` has the same shape but names the root of a standing lineage: the runtime verifies each recorded successor derivation from that root and opens the latest successor goal, and intake may start the next one under the root mandate's reviewed `successorAuthority` ([ADR-0405](../../../../../../decisions/execution/orchestration/governed-work/0405-standing-supervision-lineage.md)). A configuration with both or neither key rejects startup.

Trusted readiness configuration supplies:

- Explicit provider executables and stored-login directories.
- Required verification pins and tools.
- The isolated worker workspace parent, base commit and integration target digest.

Managed execution selects absolute Node and CLI bundle paths. Owner reasoning selects Codex or Claude, an optional model and a positive bounded token reservation.

Secrets are excluded; stored credentials remain behind the existing owner-only login boundary. Unknown fields, invalid coordinates, missing required provider material or absent workspace configuration reject startup.
