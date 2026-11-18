# Authentication and credentials

Hub endpoints authenticate before access. Each installed Node reads its bearer token from an owner-only file and reloads it atomically.

Organization deployment policy, secret-free credential grants, and the owner-only credential source were removed by [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md).
