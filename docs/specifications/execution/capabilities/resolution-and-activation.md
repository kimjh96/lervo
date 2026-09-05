# Resolution and activation

Resolution applies project-before-user precedence, semantic versions, provider and platform compatibility, role permissions, exact transitive dependencies, and bounded acyclic bundles. `.lervo/capabilities.lock` is rebuildable state containing only ID, kind, version, content hash, local source scope, and `resolved` status.

`resolved` does not mean `loaded`, `injected`, `activated`, `invoked`, or `used`. Skill entrypoints must also pass the independently valid skill manifest, resolver, and skill lock.

Related contracts:

- [Managed execution evidence](resolution-and-activation/managed-execution-evidence.md)
- [Runtime and activation contracts](resolution-and-activation/runtime-and-activation-contracts.md)
- [Workforce authority](resolution-and-activation/workforce-authority.md)
