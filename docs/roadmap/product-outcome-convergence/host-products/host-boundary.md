# Product interfaces and host compatibility

- [Complete interfaces](host-boundary/complete-interfaces.md): `delivery required`; Lervo owns a Discord-visible reference product and a future first-party surface over the headless application contracts.

[ADR-0455](../../../decisions/execution/applications/0455-ratchet-the-platform-adapter-boundary-on-neutral-seams.md) maintains the adapter boundary through a ratchet guard and neutral seams; the first-party surface remains out of scope.

[ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the separately installed host outcome with the product-host protocol, which had no invoker.
