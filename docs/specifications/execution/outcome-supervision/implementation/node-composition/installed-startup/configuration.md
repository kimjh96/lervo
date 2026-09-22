# Installed supervision configuration

Node configuration may include one `outcomeSupervision` object with required `runtimeReadiness`, `ownerReasoning` and `managedExecution` fields, exactly one of `binding` or `standing`, and optional `resultOrigin`. Both or neither of `binding` and `standing` reject startup.

`binding` names an already installed supervision ID, workstream, owner and mandate hash. Configuration selects that exact authority; it cannot install a mandate, approve a plan or widen scope.

`standing` has the same shape but names a standing lineage root. The runtime verifies every recorded successor derivation from that root and opens the latest successor goal. Intake may start the next goal under the root mandate's reviewed `successorAuthority` ([ADR-0405](../../../../../../decisions/execution/orchestration/governed-work/0405-standing-supervision-lineage.md)).

Trusted readiness configuration supplies:

- Explicit provider executables and stored-login directories.
- Required verification pins and tools.
- The isolated worker workspace parent, base commit and integration target digest.

Managed execution selects absolute Node and CLI bundle paths. Owner reasoning selects Codex or Claude, an optional model and a positive bounded token reservation.

Secrets are excluded; stored credentials remain behind the existing owner-only login boundary. Unknown fields, invalid coordinates, missing required provider material or absent workspace configuration reject startup.

Every configured Discord deployment is resolved against the current durable workforce during
preflight and live composition. A deployed `product-owner` requires exactly one matching
`outcomeSupervision` owner and `acceptsSupervisionGoals: true`; a Node cannot downgrade that role
to chat-only behavior by omitting authority or changing the intake flag. A Node without a deployed
product owner may omit supervision. This validation never installs a mandate.
