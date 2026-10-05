# Knowledge CLI command surface

This reference covers `apps/cli/src/knowledge-command.ts` and the syntax advertised in `knowledge-usage.ts`. It supplements the [background worker wrappers](../specs/background-knowledge-convergence/runtime/cli-wrappers.md).

- [Dispatch and local inspection](knowledge-cli-command-surface/dispatch.md): routing, local processing, output, errors, and exit statuses.
- [Advertised command families](knowledge-cli-command-surface/advertised-commands.md): the interface listed in help text.

Routing and help text do not establish imported handler behavior or successful execution. These two source files resolve no test, installed journey, or historical knowledge obligation.
