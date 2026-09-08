# Identity and organization bindings

Participant bindings default to `actorKind: human` and `roleId: null` when omitted. `agentId` binds the responding bot participant to an active workforce agent and derives its exact current role independently of the command role. A mapped external Discord bot can use `actorKind: agent` with an explicit role.

An optional `organization` object names exact `organizationId` and `teamId` values. Before enabling it, an owner runs `lervo organization bind-runtime --organization <id> --team <id> --config <node-config> --write`. This records repository-local team, hired-agent, external-principal, and channel membership history without copying raw Discord IDs or credentials into events.

Once configured, Node startup fails closed unless the current repository, agent role, provider policy, bot deployment, and channel set match that history.

For hired-agent deployments, normalized inbound and outbound records retain the agent ID, exact role version, contract hash, and profile hash.
