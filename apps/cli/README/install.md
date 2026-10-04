# Install

Lervo supports Node.js 22.13 and later. See the [packed CLI consumer contract](../../../docs/decisions/distribution/0088-packed-cli-consumer-installation.md) and [CLI version and release management](../../../docs/distribution/cli-version-management.md).

To install from a checkout, follow the [repository start steps](../../../README.md):

```sh
pnpm install
pnpm build
npm install --global ./apps/cli
lervo --version
```
