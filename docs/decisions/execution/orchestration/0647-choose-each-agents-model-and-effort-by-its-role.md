# ADR-0647: Choose each agent's model and effort by its role

Status: `accepted`
Decision date: 2026-11-27
Amends: [ADR-0205](0205-conflict-safe-repository-agent-workforce.md) (a team agent records the model and effort its sessions run with)
Related: [ADR-0643](0643-record-which-agents-are-lervos-own.md), [ADR-0637](../applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md)

## Context

Every hosted agent session ran on Claude Code's own default model and effort, whatever the agent's role. `lervo model` routes choose models only for Lervo's own work, such as cross-checks and background reviews. On 2026-11-27 the owner asked how hiring chooses a model, noted that Claude Code offers several, and decided that a hire is given a model and an effort suited to its role and that the owner can change both.

Claude Code takes `--model` with an alias for the latest model of a line (`fable`, `opus`, `sonnet`, `haiku`) and `--effort` (`low`, `medium`, `high`, `xhigh`, `max`). The models differ in capability and price:

- Claude Fable 5.2 is the most capable, at twice Opus's price.
- Claude Opus 5.5 is strong.
- Claude Sonnet 5.5 is a balanced everyday model at half Opus's price.
- Claude Haiku 5.5 is fast and cheap.

Code and long agentic work repay effort most. Chat and writing hold quality at lower effort.

## Decision

- **A tier, not a model name.** A team agent records `model`, with:
  - `tier`: `frontier`, `strong`, `balanced`, or `fast`, the place in its provider's line-up;
  - `effort`;
  - `source`: `role` or `owner`.

  The provider's adapter names each tier's model: for Claude Code, `fable`, `opus`, `sonnet`, and `haiku`. A provider adapter without such names runs its own default. The core keeps no provider's model names (invariant 2).

- **The role chooses at hire.**

  | Role                                       | Tier       | Effort   |
  | ------------------------------------------ | ---------- | -------- |
  | Product owner and CEO                      | `strong`   | `high`   |
  | Developer                                  | `strong`   | `xhigh`  |
  | Researcher and designer                    | `strong`   | `high`   |
  | Ideation                                   | `balanced` | `high`   |
  | Writer and marketer                        | `balanced` | `medium` |
  | Any other role, such as a repository's own | `strong`   | `high`   |

  Deciding, researching, and designing weigh judgment over speed. Code repays the most effort. Writing and ideas do well on the balanced model. The frontier model is the owner's choice for an agent whose work needs it, since it costs twice the strong one.

- **The owner changes it.** `lervo agent model` and the core link's `agent.model` set an agent's tier and effort, with `source: owner`. The change applies from the agent's next session. A running session keeps the model it started with.
- **Sessions run with it.** A hosted session for an agent launches with that agent's model and effort. That covers the lead of a new conversation, a reopened session, and an agent that joins a conversation. A team agent recorded before this decision runs with its role's choice.
- **Lervo's own agents keep Lervo's routes.** An agent with `origin: lervo` records no model. Its work runs through `lervo model` routes as before.

## State, events, privacy, and failure meaning

- **State.** `model` is an optional field of the agent record at schema version 1. Every transition spreads the record, so readers that do not know the field keep it. A record whose `model` has an unknown tier, effort, or source, or extra fields, is invalid (`agent_invalid`).
- **Events.** `agent.registered` gains `modelTier` and `effort` for a team agent. A change records `agent.identity.changed` with `changeKind: model`, `previousModelTier`, `previousEffort`, `modelTier`, `effort`, and `revision`. These fields are added to the redaction allowlist. They carry no content and no provider model name.
- **Failures.**
  - `agent_state_conflict`: a stale revision, a retired agent, or a Lervo agent.
  - `agent_argument_invalid`: an unknown tier or effort.
  - When the registry cannot be read at launch, the session runs on the provider's default model and nothing is blocked.

## Consequences

- A new project's product owner runs on Opus at high effort and its developer on Opus at extra-high effort, rather than on whatever Claude Code defaults to.
- The ADE's agent profile (S2c slice 3) shows the agent's model and changes it through `agent.model`; `agents.list` reports each team agent's model with the provider's name for it, such as "Opus".
- Cost follows the team's roles. The owner raises one agent to the frontier model, or lowers one to the fast model, without touching the others.
