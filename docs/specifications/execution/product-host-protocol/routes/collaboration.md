# Collaboration routes

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `assignment_thread.inspect` | `loop thread` | read-only |
| `assignment_inbox.inspect` | `loop inbox` | read-only |
| `assignment_mention.route` | `assignment mention` | exact plan/apply |
| `assignment_connector.route` | `assignment connector` | injected adapter for effect |
| `assignment_message_trigger.route` (v4) | `assignment trigger` | exact plan/apply |
| `assignment_handoff.acknowledge` (v4) | `assignment acknowledge` | explicit recipient write |

The v4 installed trigger adapter consumes only reviewed, content-addressed direct-message observations. Its exact plan/apply reuses current mention and handoff authority; it neither authenticates an external platform nor starts work.

Acknowledgment validates an exact active recipient-agent coordinate. It does not authenticate a human principal and never upgrades delivery or action.

Protocol v4 adds `--contract 2` to existing `assignment_thread.inspect` and `assignment_inbox.inspect` descriptors to select communication contract v2. The report exposes recorded acknowledgment and reviewed-trigger provenance.

Default CLI commands and protocol v1–v3 descriptors retain communication contract v1, with unchanged shape and unobserved acknowledgment semantics.
