# Corrections discovered through actual Discord use

The first explicitly addressed request received no response because its native Discord mention metadata was empty. The adapter now recognizes an exact leading participant address even when notification suppression removes that metadata. Unknown identities still fail closed.

The initial successful response caused unsolicited bot acknowledgements through reply references. Agent-authored reply references now retain correlation without implicitly addressing another agent. Human replies retain owner addressing; explicit participant mentions continue to work. Focused parser, platform, and ownership checks passed on Mac and WSL.

Two requests exposed stale compiled workspace packages in the WSL working repository: nineteen policy tests and five readiness tests failed on unavailable exports. Frozen-lockfile installation and a workspace build restored matching CLI, Node, and Hub artifacts. All twenty-four previously failing tests passed on the corrected native rerun. Package, workspace, and lockfile bytes remained unchanged by the repair.
