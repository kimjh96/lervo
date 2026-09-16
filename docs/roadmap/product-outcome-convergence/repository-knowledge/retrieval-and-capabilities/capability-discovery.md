# Progressive capability and tool-schema discovery and activation

State: **implemented**.

The packed CLI journey installs a reviewed skill and its exact MCP dependency, records deterministic recommendation separately from explicit selection, loads both package hashes, confirms MCP activation before the exact skill invocation, validates the result, and binds completion to its digest.

Direct terminal retrieval neither selects tools nor grants authority. Preserve distinctions among recommendation, explicit or automatic selection, dependency, loading, activation, invocation, completion, and semantic use. The deterministic provider fixture is not live-model or service-quality evidence.
