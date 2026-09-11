# Discord repository signals

Optional `repositorySignals` maps exact canonical repository event types to subscribed proactive signal codes. It requires `policy.mode: proactive`, `system` in `respondTo`, and every mapped code in `signalCodes`.

Signal messages never copy source event payloads. The selected agent resolves current information through managed repository retrieval.
