# Installed conversation contract and capabilities

## Deployments and context

An installed Node accepts a bounded collection of distinct Discord agent deployments. Each bot speaker has its own application. Webhook speakers may share the exact Gateway application and bot credential while retaining distinct webhook IDs, owner-only webhook tokens, hired-agent bindings, current role hashes, provider/model routing, storage, response ownership, and delivery adapters.

Every owned turn loads the agent's reviewed context through the managed context coordinator used for repository search and evidence.

## Turn ownership and peer binding

Shared-guild peer author and mention aliases normalize to one workforce participant per peer. Before semantic relevance, deterministic ownership:

- Assigns exact participant mentions to their addressees.
- Resolves Discord-managed bot-role mentions to exact bot participants only after authenticated guild-role verification. Unresolved role addresses never fall through to the channel default.
- Selects one participant per mentioned role.
- Selects one stable unaddressed owner using explicit per-participant priorities shared by local and cross-Node bindings. A deployment can make the central executive the general-channel default; the `CEO` role string has no special behavior.
- Preserves a human's explicit interlocutor through hiring-driven runtime restart; hiring or work assignment does not make the new assignee the human's conversation target.
- Releases missing or idle interlocutors and deterministically selects exactly one current owner.

Non-owners record `turn_not_owned` without typing or provider work. Owner typing begins with semantic resolution and continues through active native work. Bounded recent context retains participant, agent, and role identity. Aggregate readiness and failure remain fail-closed.

A successful hire publishes its bounded acknowledgment before requesting runtime reconfiguration. The owner of a subsequent work instruction starts visible typing and ends with one verified result, duplicate-suppression notice, or bounded terminal failure. Silence is not successful completion.

Within a multi-bot Node, an exact reviewed manual participant binding overrides the automatic co-resident binding for the same tenant and speaker identity. This permits a coordinating agent to start a bounded automation chain without conflicting identity rows; the override does not extend to every peer.

## Proactive signals, deliberation, and effects

Installed deployments map bounded canonical repository event types to proactive signals and run explicit cross-provider deliberation through the durable queue. Both preserve deterministic ownership, managed retrieval, provider budgets, repository verification, CAS, and event evidence. Discord is the current transport only.

Generic `assignment.completed` signals no longer start conversation turns: frequent background knowledge completions had awakened an expensive general-channel model reader. Origin-bound result delivery remains the completed-work acceptance path. Installed verification must show convergence completions advance the repository-signal cursor without new proactive provider runs while other configured signals still work.

Named conversation speakers and formal policy seats are separate identity planes. Ordinary Discord speakers require durable hired-agent bindings: `agentId`, role version and hashes, participant, and bot or webhook deployment. A formal policy seat stays internal unless an explicit route joins it to one exact active organization membership, deployment, channel membership, provider policy, model, and effort.

Before formal execution, the repository-local participant runtime must accept that immutable route. Work causality records the durable agent; the verified workforce role supplies role and context profile; artifact publication uses the attached speaker deployment without a synthetic seat heading. Presence, provider compatibility, and matching job labels cannot create a binding. User-facing copy must not present unbound policy roles as speakers. Installation must not create same-named shadow webhooks or agents for an already bound application bot.

The executive boundary executes hash-bound, allowlisted Discord text-channel and public-thread effects with durable replay and fail-closed uncertainty. The deliberation worker reconciles uncertain outcomes using canonical CLI evidence and publishes a bounded visible result through the managed conversation path.

Natural deliberation preserves the original human reply coordinate across synthetic status signals and bounded prior human anchors for references such as "this design." It selects a versioned Korean or English conversation writing contract from the source request. Failed writing checks feed the one bounded repair attempt rather than an undirected rewrite.

## Implemented capabilities

- Webhook-backed delivery; same-Node and explicitly bound cross-Node peer-author normalization.
- PO-to-worker, worker-to-PO, and worker-to-worker addressed delegation through receiver-owned runtimes or exact cross-Node Discord addresses.
- Explicit peer display addresses and unaddressed priorities shared across Nodes.
- Shared-Gateway validation and replay-safe executive webhook preparation.
- Authenticated parent/thread resolution, native thread delivery, bot-native replies, and source-message reply correlation.
- Natural allowlisted text-channel and current-channel public-thread creation.
- Natural repository-scoped child-agent hiring by an exactly bound product owner; atomic child organization, external-deployment, and channel-membership binding before supervised activation.
- Exact leading `@DisplayName` addressing for webhook participants Discord cannot natively mention.
- Resumable native Codex and Claude repository work: durable per-agent sessions, duplicate suppression, bounded result artifacts, and Git change observation.
- Provider-native progress-renewed inactivity windows plus a separate absolute turn bound for Codex and Claude. Neither a fixed wall-clock cutoff during active verification nor an intermediate message is a completion receipt.
- WSL single-writer execution by default, retaining native conversation work while conflict-safe Mac recovery replicas preserve exact uncommitted worktree and index bytes for explicit reconciliation. Strict fresh parity is opt-in for controlled topologies; peer-command execution is bounded, bridge concurrency configurable, and terminal completion detectable for an unloaded installed coordinator.
- Post-turn enforcement of current workstream, canonicalization declaration, and repository knowledge lifecycle; bounded CAS-backed prior work results per durable worker.
- Stable CEO ownership of unaddressed general-channel turns, early owner-only typing, and bounded durable human-interlocutor focus shared by co-resident deployments and recovered after restart.
- Semantic repository-work profiles: routine work uses balanced settings; design, judgment, and review use high effort. Provider-bound session identity is preserved and allocation reasons recorded.
- Repository-local named formal participants with distinct policy-seat and workforce-role evidence, seat-specific model/effort, resume stability, and existing-speaker publication.
- Internal-only unbound policy coverage, actual bound-role context loading, repair headroom above the 24-call best-case baseline, and exact terminal failure reasons in Discord.
- Pre-provider natural-discussion admission requires at least two distinct verified real participant runtimes; otherwise it returns a bounded no-work reply without queueing or partial publication.
- Authenticated cross-Node natural discussion between the decision owner and two selected real bot peers: receiver-owned envelopes, identity-normalized explicit active targets, exact agent bindings, per-agent role/repository context, serialized independent reviews under one installed-host provider slot, content-addressed contributions, and one coordinator synthesis.
- Discussion coordination ownership resolves from durable discussion state before ordinary reply mentions. First and second assignments use distinct nonce sequences so Discord replay protection cannot suppress serialized handoff.
- Discussion prompts distinguish the current durable speaker from prior accepted speakers, preserve intentional independent-review isolation, keep same-role participants distinct, and treat injected workstream status as historical unless the current turn provides fresh evidence.
- Restart-safe discussion deadlines return a bounded non-converged result from verified partial evidence or a fixed no-contribution terminal result; interactions do not remain pending.
- Review and synthesis use independently configured high-effort profiles and per-route time budgets; routine turns stay balanced. One safe read-only retry covers provider start or terminal-turn failure, and managed usage is attributed to the executing agent.
- Provider-reported model overload is distinct from generic turn failure and uses bounded read-only backoff. Claude native work accepts a final assistant body only if the terminal result explicitly reports success and that body followed the last tool interaction.
- A configured request-scoped runtime effect runs a Node-owned process that survives the provider turn without boot enablement or automatic restart. It stops on explicit close, bounded expiry, or Node shutdown.

## Organization and natural hiring

The target organization has one shared general channel for the human owner, central executive, and all repository product owners, plus one project channel per product owner.

Before child identity creation, natural hiring binds the exact product-owner parent, organization deployment, current repository, selected installed role, provider policy, delegation depth, responsibility paths, and capability ancestry. The child becomes the active worker for the conversation's next native work turn with a separate resumable provider session; this does not change the human interlocutor.

An authorized parent-agent hire prepares and atomically binds a webhook-backed speaker before post-acknowledgment activation. Cross-team hiring is prohibited. A central-executive request spanning repository teams and cross-repository formal assignment remain separate bounded effect paths.
