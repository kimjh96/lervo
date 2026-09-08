# Organization routes

| Route | CLI prefix | Authority |
| --- | --- | --- |
| `organization_team.bind` (v7) | `organization bind-team` | explicit write |
| `organization_team.reclassify` (v7) | `organization set-team-kind` | explicit write |
| `organization_portfolio.inspect` (v7) | `organization portfolio` | read-only |
| `agent_context.inspect` (v7) | `agent context inspect` | read-only |
| `agent_context.promote` (v7) | `agent context promote` | reviewed context promotion |
| `agent_context.handoff` (v7) | `agent context handoff` | explicit write |
| `organization_ceo.evaluate` (v7) | `organization ceo-evaluate` | bounded CEO policy |
| `organization_executive.execute` (v7) | `organization executive-execute` | exact approved external effect with durable replay |

Protocol v7 composes repository-owned team snapshots without creating central state authority.

Team reclassification changes only the exact binding's kind under a monotonic event revision. Context promotion requires an exact source, CAS summary, and qualifying review; handoff names exact source-owned entries.

CEO evaluation verifies the content-addressed operating report, appointment, action and team allowlists, automation depth, observed budget policy, and approval. It returns a decision without performing the effect.

Executive execution additionally binds that decision to an exact payload and installed adapter. Its durable replay store returns a verified receipt or fails closed without repeating an uncertain external effect.
