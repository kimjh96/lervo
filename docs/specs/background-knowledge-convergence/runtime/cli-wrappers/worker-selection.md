# Worker selection and stages

`runKnowledgeWorker` selects the autonomous runtime when the writable event schema version is at least four and no custom host is supplied. In this path, a supplied `maximumJobs` becomes `maximumStages: Math.min(8, maximumJobs)`. Otherwise, it invokes the repository knowledge compiler worker with the optional host and maximum-job setting. It attempts storage closure in the finalization step.

The command accepts `codex` or `claude` and requires `--once` or `--watch`. `--watch` takes precedence when both flags occur. `--once` prints the worker result as JSON. The wrapper does not strictly parse or reject every additional argument.
