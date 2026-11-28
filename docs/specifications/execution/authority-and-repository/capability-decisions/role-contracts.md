# Role Contracts and Transitions

Every role declares `allow`, `deny`, or `require_approval` for filesystem reads and writes, shell processes, network, external messages, deployments, and data changes. Missing policy is an error.

Built-in `1.0.0` templates are developer, researcher, marketer, designer, writer, and ideation. Lazy tracked roles under `.lervo/roles/` may be complete, specialize one exact version, or compose multiple exact versions.

Every Git worktree of a repository shares one agent registry, so the roles its agents name resolve in each worktree. A linked worktree, such as an ADE workspace, reads its own `.lervo/roles/` and then the main checkout's roles it lacks. That covers a role no commit holds yet, such as a template written on a first hire. The two resolve to the same contract hash. A template the main checkout keeps is present, so hiring in the worktree writes no copy there. Lervo finds the main checkout from Git's own `.git` and `commondir` files, without running Git.

Final profiles and evaluation bundles must validate. Ancestry must be acyclic and at most eight levels deep. Capabilities and verification-failure policy merge to the most restrictive result. The resolved definition and ancestry receive a deterministic contract hash.

Agent, assignment, handoff, and managed-run transitions fail before provider creation if the bound version, contract hash, profile hash, or capability hash is stale.
