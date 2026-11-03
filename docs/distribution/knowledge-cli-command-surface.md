# Knowledge CLI command surface

This reference covers `apps/cli/src/knowledge-command.ts` and the syntax advertised in `knowledge-usage.ts`. It supplements the [background worker wrappers](../specs/background-knowledge-convergence/runtime/cli-wrappers.md).

- [Dispatch and local inspection](knowledge-cli-command-surface/dispatch.md): historical routing, local processing, output, errors, and exit statuses, with an explicit command-removal boundary.
- [Advertised command families](knowledge-cli-command-surface/advertised-commands.md): the interface listed in help text.

[ADR-0529](../decisions/knowledge/semantics/0529-remove-the-semantic-compilation-pipeline.md) removes `compile`, `compare`, `stability`, `merge-candidate`, `fuzzy-merge-candidate`, `reconcile`, `review-policy`, and `review`, plus `materialize <review-id>`. The linked dispatch descriptions retain historical behavior and do not establish availability of those commands. `materialize --recover` remains supported by that decision.

Routing and help text do not establish imported handler behavior or successful execution. These two source files resolve no test, installed journey, or historical knowledge obligation.
