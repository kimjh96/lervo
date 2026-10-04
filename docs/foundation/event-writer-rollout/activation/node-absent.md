# Hub-enabled repository without a Node

A Hub-enabled clone with no registered Node on its host follows [local-only activation](local-only.md). In this case, `lervo event-contract evidence` reports `authority.kind: repository_node_absent_v1` and the local runtime as the only reader, because only a Node synchronizes events to the Hub.

Retire or upgrade a stale registration for the repository first. Any matching registration requires [Hub-enabled activation](hub-enabled.md).
