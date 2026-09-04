# Dynamic execution graphs

Outcome: execution graphs support bounded dynamic branches, joins, and reviewed topology changes.

State: `partial`.

Assignment dependencies form an acyclic rebuildable DAG; routines materialize fixed reviewed templates. Dynamic mutation and arbitrary cycles are unsupported.

Completion proof: introduce a new versioned graph contract only with topology authority, cycle bounds, migration, recovery, and historical replay.
