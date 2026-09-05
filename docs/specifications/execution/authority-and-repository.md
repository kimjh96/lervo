# Execution Authority and Repository Changes

Related specifications are linked from the [execution specification](../execution.md).

## Capability decisions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network, external messages, deployments, and data changes. Missing policy is an error.

Capability packages cover skills, MCP servers, plugins, and bundles. Verified metadata supports deterministic natural-language selection. Recommendation, selection, load, activation, and invocation remain separate evidence; none proves semantic model use.

Built-in `1.0.0` templates are developer, researcher, marketer, designer, writer, and ideation. Lazy tracked roles under `.lervo/roles/` may be complete, specialize one exact version, or compose multiple exact versions. Final profiles and evaluation bundles must validate; ancestry must be acyclic and no more than eight levels deep. Capabilities and verification-failure policy merge to the most restrictive result. The resolved definition and ancestry receive a deterministic contract hash.

Agent, assignment, handoff, and managed-run transitions fail before provider creation if the bound version, contract hash, profile hash, or capability hash is stale.

Write approval binds project, run, session, provider, role, risk, request digest, repository snapshot, expected paths, verification suite, policy snapshot, validity interval, and revocation. Revalidate it immediately before mutation.

## Repository snapshots and writes

Plans bind state, expected paths, before and desired hashes, and verification. Apply rejects symlinks, escapes, changed targets, unapproved paths, and stale plans.

Every managed-write provider turn receives the exact repository-relative target path and an instruction to change only that path, for single-file and multi-file schedules. Write authorization and byte verification remain authoritative.

Snapshots cover repository-authored source and tracked generated files. They exclude runtime data and state, dependencies, and conventional generated build or cache directories. User content changes only through explicit content-bound operations. Managed blocks preserve outside bytes. Generated files may change or be deleted only when recorded generation proves current-hash ownership.

Repository assignments bind role, dependency, acceptance, verification, approval, workstream, and path coordinates. Short atomic leases serialize overlapping scopes while disjoint root agents and subagents share one lease and handoff contract. Managed execution revalidates lease, provider, role, path, and suite authority before provider creation. Generation-bound expiry permits recovery but never proves former external work stopped.

Assignment interactions, routines, and connectors have separate specifications; governed loops defines bounded continuation.

## Verification

Suites declare exact commands, working directories, limits, and outcomes. Lervo compares pre- and post-snapshots and rejects unexpected changes. Bounded command output is artifact data, not event content.

## Repository knowledge

Tracked sources and canonical Markdown govern knowledge; `.lervo` stores policy, provenance, manifests, and rebuildable state. Structural planning is read-only, exact bindings and approvals protect bytes, and isolated provider output never becomes truth merely because it materialized successfully.

The repository knowledge compilation specification owns scanner, taxonomy, normalization bounds, caching, retry, publication, durable apply, lifecycle, skill, entrypoint, agent-surface, and recovery details.

## Entrypoints and language

README is concise human onboarding; AGENTS is concise provider-neutral guidance; CLAUDE is a thin AGENTS bridge. Generated publications use a versioned catalog and tracked language. Normalization uses that language and a versioned profile; v1 supports English. Neutral localized titles preserve exact encoded paths.

Repository upgrade treats an instruction-bridge binding made stale solely by an ordered AGENTS or CLAUDE rewrite as a bounded transitional finding. The next generated-only stage must refresh the bridge binding. The upgrade must not claim completion before convergence; final deterministic knowledge lint remains mandatory.

Human writing binds `publication.language` to `writing_en-human`, semantic checks, policy hash, evaluation, and permit. Deliberation carries locale through profiles, prompts, verdicts, evaluation, and publication. Unsupported locales fail before execution; provider prose never implies approval.

Initialization creates minimum configuration; feature and state directories remain lazy. Durable local data and rebuildable projections follow the state lifecycle specification.
