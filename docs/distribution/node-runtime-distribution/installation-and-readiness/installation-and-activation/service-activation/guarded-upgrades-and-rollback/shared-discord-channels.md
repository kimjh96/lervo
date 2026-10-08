# Shared Discord channel changes

As an alternative to [pinned deliberation CLI changes](pinned-deliberation-cli.md), the same [guarded transition](transition-guards.md) may add one already shared Discord channel to one identity, with no other candidate changes.

For an organization-bound identity, rebind the durable deployment under the same stopped-service work freeze and restore its predecessor binding on rollback. Preflight the replacement after the rebind and observe the Node's `conversation.status: ready` after activation.
