# Role Contracts and Transitions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network, external messages, deployments, and data changes. Missing policy is an error.

Built-in `1.0.0` templates are developer, researcher, marketer, designer, writer, and ideation. Lazy tracked roles under `.lervo/roles/` may be complete, specialize one exact version, or compose multiple exact versions.

Every Git worktree of a repository shares one agent registry, so the roles its agents name resolve in each worktree. A linked worktree, such as an ADE workspace, reads its own `.lervo/roles/` and then the main checkout's roles it lacks. That covers a role no commit holds yet, such as a template written on a first hire. The two resolve to the same contract hash. A template the main checkout keeps is present, so hiring in the worktree writes no copy there. Lervo finds the main checkout from Git's own `.git` and `commondir` files, without running Git.

Final profiles and evaluation bundles must validate. Ancestry must be acyclic and at most eight levels deep. Capabilities and verification-failure policy merge to the most restrictive result. The resolved definition and ancestry receive a deterministic contract hash.

Agent, assignment, handoff, and managed-run transitions fail before provider creation if the bound version, contract hash, profile hash, or capability hash is stale.

## Project roles

[ADR-0662](../../../../decisions/coordination/conversations/agent-organization/0662-let-a-lead-shape-the-projects-roles-and-name-hires-like-people.md) lets a lead shape a project's own roles. The built-in roles are Lervo's central templates and are never edited or removed by a project (`role_built_in`).

- `lervo role add --name <name> --description <text> --from <role-id> [--role <role-id>] [--request-types <type,...>] [--capability <permission>=<decision>] --write` writes `.lervo/roles/<role-id>.json` at `1.0.0`, extending one template at its exact current version. The ID derives from the name when `--role` is absent, such as `drawing-understanding`, or `role-<hash>` for a name without ASCII words. `--source <file>` adds a complete v1 source instead. A taken ID fails with `role_exists`, and a name another role has, compared ignoring case, with `role_name_conflict`.
- `lervo role edit --role <role-id> [--name] [--description] [--request-types <type,...>] --write` writes the next minor version. `--request-types` replaces the request types the role adds to its template's; an empty value clears them. The same command moves every agent and assignment bound to the role to the new version through the workforce role-binding refresh. A blocked refresh restores the previous source and fails with `role_binding_blocked`. An edit that changes nothing writes nothing.
- `lervo role remove --role <role-id> --write` removes a role only while no agent that is not retired, and no assignment that has not ended, holds it (`role_in_use`, with the holders' IDs). Lervo never reassigns an agent's role on its own. The removed bytes stay in the project's local `removed-roles/` data, at most 32 files, so the notice's undo can add the role back.
- A role that another role extends is neither edited nor removed (`role_extended`), since its exact ancestry pin would break.
- `lervo agent role --agent <agent-id> --role <role-id> --revision <n> --write` moves an agent to another role. An active agent is paused for the move and resumed after it, each as its own transition, and a failed move resumes it at its old role.
- An agent that runs these commands from its own session, named by `LERVO_AGENT_ID`, needs `organization.coordinate` among its role's request types to change roles or move agents, and `agent.hire` to hire. Without it the command fails with `agent_not_authorized`. The owner's terminal and the ADE need neither.
- An ended assignment with an exact stored binding stays readable after its role source is removed, as a retired agent does. The workforce role-binding migration refreshes neither.
- Each change records one effect notice: `role_added`, `role_edited`, `role_removed`, or `role_template_written`. A widened edit names the request types it added and the agents it moved.
