# State and repository nodes

Durable event, CAS, and workforce data lives under `.lervo/data`. `lervo state status` inspects rebuildable `.lervo/state`; `lervo state reset` requires an exact approval plan and preserves durable data. Workstream state reconstructs from its latest event and CAS artifact.

For Hub-enabled repositories, `lervo repository node plan|apply|status` manages repository-node services through exact plans and owner-only external configuration.
