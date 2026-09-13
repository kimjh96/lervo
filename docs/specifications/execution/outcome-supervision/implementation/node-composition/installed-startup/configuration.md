# Installed supervision configuration

Node configuration may include one `outcomeSupervision` object with required fields `binding`, `runtimeReadiness`, `ownerReasoning` and `managedExecution`, and optional `resultOrigin`.

The binding names an already installed supervision ID, workstream, owner and mandate hash. Configuration selects that exact authority; it cannot install a mandate, approve a plan or widen scope.

Trusted readiness configuration supplies:

- Explicit provider executables and stored-login directories.
- Required verification pins and tools.
- The isolated worker workspace parent, base commit and integration target digest.

Managed execution selects absolute Node and CLI bundle paths. Owner reasoning selects Codex or Claude, an optional model and a positive bounded token reservation.

Secrets are excluded; stored credentials remain behind the existing owner-only login boundary. Unknown fields, invalid coordinates, missing required provider material or absent workspace configuration reject startup.
