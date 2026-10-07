# Node API baseline

This retained source description is unverified and subject to the [evidence correction](../code-quality-and-commit-ci.md). The alignment rule and source configuration require configuration and test bytes; the incident requires incident or execution evidence.

The retained description states:

- Root `engines.node` declares the oldest supported Node release, and every repository workflow runs that release.
- The `@types/node` development dependency uses a tilde range on the same major and minor version, allowing typecheck to reject APIs absent from the minimum's type definitions.
- Newer definitions can accept APIs that fail at runtime on the minimum. A claimed historical mismatch allowed code reading `DatabaseSync.isOpen`, absent in Node 22.13, to pass typecheck and fail release preparation. That incident is not established here.
- Code requiring a newer Node API must raise `engines.node`, workflow Node versions, and the `@types/node` range together.
- Raising the minimum drops support for existing installations and requires reviewed `minor` or `major` release intent under [CLI version and release management](../../distribution/cli-version-management.md).
- `scripts/quality/test/code-quality-workflow.test.mjs` verifies alignment of all three values.
