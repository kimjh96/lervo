# Authentication and authority

## Remote execution

Hub operations require authentication and registered project coordinates. Transport grants no execution authority. Remote-command signatures bind signer purpose, Node, project, time bounds, nonce, idempotency, capability, and content-addressed artifacts. Before execution, a Node revalidates trust, registration, manifest, local policy, approval, snapshot, freshness, and replay.

## Organization policy and credentials

Organization deployment policy is a separate signed, content-addressed boundary. V1 requires strict project tenancy and explicit per-project principals. Credential issuance and runtime delivery use different principals; rotation and revocation have separate permissions. Policy bounds runtime permissions, lifetime, and overlap. Missing policy authority denies the organization operation but never disables local-only execution.

Credential grants bind policy hash, repository identity, Node, destination, subject, permissions, generation, and validity; they contain neither material nor a source location. An injected source supplies bounded bearer bytes only after authority, time, and revocation checks; an injected consumer confirms activation. Source bytes are cleared on every post-load exit. Delivery receipts contain `secretMaterial: excluded` and prove neither authentication nor later use.

## Owner-only file source

The bootstrap adapter binds exact credential IDs to runtime-private paths in an immutable in-memory snapshot. It performs bounded, no-follow, owner-only reads, clears its raw buffer, and exposes only the returned byte array to the delivery contract. It does not issue credentials, persist bindings, activate or reload a Node, select an external secret authority, or add source coordinates to organization records.

## Installed Node activation

An installed Node may opt into organization delivery with one explicit organization Node ID. Before reading the existing owner-only bearer file, the application binds each grant to that ID, the loaded repository identity, and its Hub destination. It verifies the candidate through the authenticated project-registration exchange before replacing the running token. Failure preserves the prior in-memory token and creates no receipt. Credential mutations are exclusive.

Activation proves neither every permission nor synchronization, readiness, later use, durable file rollback, or rollout.

See [ADR-0228, ADR-0230, and ADR-0231 in the coordination references](../hub-and-node.md#references).
