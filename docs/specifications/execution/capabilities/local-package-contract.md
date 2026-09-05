# Local package contract

`lervo-capability.json` defines one immutable `skill`, `mcp_server`, `provider_plugin`, or `bundle` package. It binds an ID, semantic version, content hash, provenance, provider and platform compatibility, required role permissions, exact dependencies, kind-specific entrypoint, explicit activation, and secret exclusion. Kind and entrypoint must agree.

- [Discovery and selection](local-package-contract/discovery-and-selection.md)
- [Storage and installation](local-package-contract/storage-and-installation.md)
- [Reader and secret constraints](local-package-contract/reader-and-secret-constraints.md)
