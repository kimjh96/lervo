# Workforce authority

Roles may list `defaultCapabilityPackages`. Hired agents bind exact package versions and hashes into their capability hash. Subagents inherit the parent set and may narrow but cannot expand it. Before provider creation, workforce execution re-resolves requested packages and rejects drift or authority expansion.
