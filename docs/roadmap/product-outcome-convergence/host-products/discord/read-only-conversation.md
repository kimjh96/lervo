# Natural-language Discord conversation routing

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

## Purpose

A mapped participant sends an ordinary message in the configured Discord conversation, with or without a bot mention. A no-capability semantic adapter classifies the bounded turn as an informational answer, write-capable continuation, or clarification. Informational and unclear requests remain read-only; only a sufficiently confident human mutation request reaches the signed exact-workstream continuation path.

## Design

The implementation separates: conversation participation, semantic intent resolution, read-only provider composition, Hub continuation, and platform delivery. The read-only role denies filesystem writes, shell execution, network access, external messages, deployment, and data mutation. Natural replies use a multilingual chat contract and require managed context evidence and independent publication evaluation.

Participant bindings can represent humans or agents. Agent response is opt-in and retains role identity, automation-depth limits, and hourly rate limits so the same event boundary can later feed managed deliberation without enabling autonomous reply loops or agent-authored repository mutation.

## Validation

Focused tests prove:

- Unmentioned ordinary messages and mentioned messages enter the same semantic router.
- Bounded prior turns are supplied.
- Read and continuation delegates remain separate.
- Installed-runtime participation no longer requires a mention.

Gateway control traffic remains responsive during long provider work, subsequent messages retain order, and response-only typing activity is bounded and best-effort.

The outcome remains `delivery required` until the configured external Discord channel receives consecutive provider-generated answers to unmentioned natural-language questions without a missing inbound event.

## Configuration

The response path injects the exact current workstream instead of forcing routine status questions to rediscover it with provider tools. Intent, response, and independent publication evaluation have separate provider/model settings; bounded reasoning effort is configurable for managed response and evaluation adapters.

The measured pre-change managed response baseline is 19.6–51.4 seconds across seven recent runs. An external post-deployment round trip is required before claiming improvement.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
