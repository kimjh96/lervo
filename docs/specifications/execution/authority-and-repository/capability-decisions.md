# Capability Decisions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network, external messages, deployments, and data changes. Missing policy is an error.

Capability packages cover skills, MCP servers, plugins, and bundles. Verified metadata supports deterministic natural-language selection. Recommendation, selection, load, activation, and invocation remain separate evidence; none proves semantic model use.

Built-in `1.0.0` templates are developer, researcher, marketer, designer, writer, and ideation. Lazy tracked roles under `.lervo/roles/` may be complete, specialize one exact version, or compose multiple exact versions. Final profiles and evaluation bundles must validate. Ancestry must be acyclic and at most eight levels deep. Capabilities and verification-failure policy merge to the most restrictive result. The resolved definition and ancestry receive a deterministic contract hash.

Agent, assignment, handoff, and managed-run transitions fail before provider creation if the bound version, contract hash, profile hash, or capability hash is stale.

Write approval binds project, run, session, provider, role, risk, request digest, repository snapshot, expected paths, verification suite, policy snapshot, validity interval, and revocation. Revalidate it immediately before mutation.
