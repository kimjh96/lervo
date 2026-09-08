# Participants and execution settings

## Identity and organization bindings

Participant bindings default to `actorKind: human` and `roleId: null` when omitted. `agentId` binds the responding bot participant to an active workforce agent and derives its exact current role independently of the command role. A mapped external Discord bot can use `actorKind: agent` with an explicit role.

An optional `organization` object names exact `organizationId` and `teamId` values. Before enabling it, an owner runs `lervo organization bind-runtime --organization <id> --team <id> --config <node-config> --write`. The command records repository-local team, hired-agent, external-principal, and channel membership history without copying raw Discord IDs or credentials into events. Once configured, Node startup fails closed unless the current repository, agent role, provider policy, bot deployment, and channel set match that history.

For hired-agent deployments, normalized inbound and outbound records retain the agent ID, exact role version, contract hash, and profile hash.

## Response limits and providers

`maxResponseAttempts` accepts 1 through 10 and defaults to 3. It bounds response generation and publication attempts, not Discord REST delivery attempts, which retain their separate durable outbox policy.

Add `agent` to `policy.respondTo` only for a bounded agent conversation or deliberation deployment. Automation depth and hourly response limits remain mandatory loop controls.

The managed provider host accepts optional provider-keyed `models` and `reasoningEfforts` beside `executables`. These adapter inputs do not expand provider or role allowlists.

## Command completion

A changed continued command is accepted only after its exact workstream advances and repository knowledge migration, normalization, and lint are current. Discord administration does not invoke repository finalization because it cannot change repository bytes. Standalone commands retain their bounded coordinator contract.
