# Direct hooks

Direct Codex/Claude hooks use a self-verifying, repository-local contract-v2 runtime. The shared command defaults to compact context within 4,096 UTF-8 bytes, without a provider call. `LERVO_TERMINAL_CONTEXT=retrieval` restores per-prompt provider projection and document retrieval under the shared deadlines.

Compact preparation records an empty deterministic query projection and retrieves no documents. It records `unmanaged_terminal_retrieval_only` without semantic-action coordinates, effect, workflow, authority, external route, or durable rule. It creates no managed run and proves no acceptance, understanding, or use.

Under [ADR-0531](../../../../decisions/execution/providers/hooks/0531-bound-terminal-hooks-and-retain-degraded-context.md), internal prompt failure retains independently read base context and a closed degraded code. It creates no new preparation evidence for a missing snapshot. Failed stage recording is best effort; unavailable storage is never successful inspection evidence. Managed execution stays typed and fail-closed.

The lifecycle cache binds CLI version, repository revision, supplemental-source digests, and generated-projection digests. Any change invalidates it.

Direct root `Stop` records bounded lifecycle and reference observations when possible. Non-current state records `action_required` with completion `allowed`. Unmatched audits return empty success without completion evidence. Internal audit errors return empty success and record a closed stage failure reason when storage permits.

Agents still update workstreams and declarations after changes. Attached workers retain fail-closed isolation: returned inspection issues and checkpoint/pause failures keep completion blocked. Capture failure cannot skip this decision and is recorded without failing the turn. A recovered failure may attach a closed reason to a completed stage observation; it does not change the lifecycle outcome. Reference tokens are standalone Markdown HTML comments; legacy v1 tokens remain valid in flight.

A current workstream must match its latest event and CAS artifact. Managed runs load exact bytes before E3. Normal compact hooks include a prefix within the shared 4,096-byte bound and record bounded identity, revision, hash, byte, and scope coordinates. Degraded context includes only a verified recorded headline and revision, labels freshness uninspected, and makes no snapshot-bound preparation claim. Missing or stale direct state is a finding, not permission or completion evidence.
