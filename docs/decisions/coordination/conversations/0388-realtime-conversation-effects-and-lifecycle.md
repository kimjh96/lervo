# ADR-0388: Realtime conversation effects and lifecycle

- Status: accepted
- Decision date: 2026-09-08

## Context

The first natural-language Discord deployment delivered messages but did not behave like a persistent colleague. A bot guild-nickname change request entered the repository continuation queue and exposed delivery, workstream, provider, and role identifiers in an English receipt. Seven observed turns took 28 to 102 seconds. A 30-second inbox lease expired during provider work, allowing concurrent retry of the same response. The retry's new participation decision ID missed the response artifact cache, duplicated provider work, and interrupted typing.

Conversation transport, repository execution, and platform administration are distinct effects. Routing every mutation through repository continuation cannot provide a correct conversational surface or bounded external authority.

## Decision

### Conversational publication

Primary Discord prose describes human-visible state and results. Queue acknowledgements and execution-result messages exclude delivery, run, workstream, assignment, agent, and content-hash coordinates; durable internal records retain them for inspection. Repository continuation acknowledgements confirm receipt and promise a later verified result without claiming that queueing changed the repository.

A queued execution origin retains only the coarse response language `en` or `ko` for fixed failure and completion framing in the request language. It contains no message body.

### Effect routing and authority

Intent resolution returns `answer`, `continue_work`, or `clarify` and binds one structured effect:

| Effect | Required fields | Authority and meaning |
| --- | --- | --- |
| `none` | kind | No mutation may occur |
| `repository_work` | kind | Use the signed exact-workstream Hub continuation path |
| `discord_current_member_nickname_set` | kind, nickname | Change only this authenticated bot member's nickname in the mapped guild |

The resolver receives available effect kinds. An unavailable effect becomes clarification and never falls through to repository work. The immutable intent record binds effect JSON alongside its existing event, message hash, provider, model, confidence, digest, and time. The nickname is a bounded 1 to 32 character platform argument and may repeat that small source value; the full message remains only in CAS.

`discordConversation.administration.allowedActions` grants explicit platform authority. The first action is `current_member.nickname.set`. The Discord adapter accepts only configured guild IDs, uses the current bot member endpoint, verifies the returned application ID and nickname, and never accepts a target user ID. Only a mapped human may request this action. API rejection or response mismatch is a response failure and cannot be reported as success.

Discord application creation, bot-token issuance, and guild installation are owner or OAuth provisioning transitions, not Discord Bot API capabilities. A future CEO agent may manage channels, roles, membership, and a pre-provisioned bot pool only through separately allowlisted actions and receipts.

### Interaction ownership and retry

The durable inbox lease renews during active response work. The installed managed-provider deployment also uses the bounded five-minute lease maximum so ordinary provider latency cannot let a second worker reclaim the turn before the first renewal. After a process crash, reclaim remains possible after the final lease expiry.

The response request digest binds stable event, policy, semantic participation outcome, role, message hash, response limit, and prior turns. It excludes the per-attempt decision ID. One process-local single-flight registry shares generation and publication for concurrent identical requests; the durable artifact mapping preserves restart reuse.

Typing belongs to the conversation response lifecycle. One activity lease begins when the selected response starts, persists across a scheduled retry, and stops on completion, terminal failure, abort, or a five-minute safety limit. Typing is best-effort, not durable evidence.

The remote-command policy loop is an independent control plane. A typed policy verification failure produces `policy_rejected` with the bounded `failureCode`, skips command leasing, reports remote control as degraded, and retries after the configured delay. Conversation ingress and synchronization continue. Unknown programming failures still terminate the Node. The state excludes policy bytes, target coordinates, signatures, and unrestricted error text. `policy_rejected` means repository commands are fail-closed while unrelated conversation service remains available.

### Realtime and reviewed writing profiles

Managed read responses retain the provider-neutral run coordinator, selected and injected repository context, CAS artifacts, run events, provider session binding, deterministic writing checks, and provider token and cache telemetry. Without `routing.evaluation`, `writing_mul-realtime-conversation` removes the second synchronous model call and makes no semantic-review claim. With `routing.evaluation`, `writing_mul-conversation` retains the independent fail-closed semantic pass.

Repository mutation retains the configured command provider and managed remote host. Changed continuations must advance the exact workstream and leave knowledge migration, normalization, and lint current. Discord platform actions invoke neither repository hooks nor workstream finalization because they do not mutate repository state.

## Failure and evidence meaning

No new global event is added. Storage ownership remains:

- Intent SQLite: immutable requested effect.
- Interaction SQLite: attempt, lease, retry, terminal failure, and outbound state.
- Conversation-result SQLite: internal execution coordinates and coarse response language.
- CAS: message and published reply bytes.

A platform API response proves success only after scope, authenticated application identity, and returned value match. A natural acknowledgement proves only entry into the selected path. A delivered completion reply remains separate from repository change and verification evidence.

## Consequences

Direct Discord administration is separate from repository work, and normal replies no longer resemble internal queue diagnostics. Common execution and evidence contracts remain provider-neutral while latency-sensitive publication can avoid a redundant model pass. External p95 acceptance still requires a post-deployment sample of real human-authored turns; unit and simulated Gateway tests do not establish it.

## References

- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Terminal outcomes for conversation response failures](0387-terminal-conversation-response-failures.md)
