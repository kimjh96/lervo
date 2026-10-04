# Earlier transitions

The earlier Node correction limits worker authority revalidation to five seconds and prevents renewal after cancellation. All seven WSL services passed exact-predecessor upgrades.

Two observations 58.456 seconds apart verified the new Node bundle, unchanged Hub and configuration hashes, stable PIDs, ready health, and zero automatic restarts. Local and HTTPS Hub readiness returned 200 with the expected identity. Evidence: `sha256:4281e25bf61937cf1dbb9d64f04ed6ff66a9acff21a1195c7256138037fe2429`.

The predecessor Node bundle `1d13818d` passed observations at 23:16:57 and 23:17:27 UTC on 2026-09-12. Historical receipt: `sha256:9f3bc186d926f38287425d877eb78202035913b833fbb08a8cc63a10179c392b`.

All seven configurations omit `outcomeSupervision`; successful deployment does not establish supervision activation.
