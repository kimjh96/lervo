# Instruction-capture host convergence

Capture behaves identically on every host, regardless of who holds the [ADR-0466](../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) convergence owner lease.

## Execution and gates

| Step | Where it runs | Gate |
| --- | --- | --- |
| Queue an owner turn | Host whose hook or conversation runtime observed it | None |
| Assess the turn | Same host, in `runOwnerTurnCaptureWork` on every resident cycle, owner or not | Host's delegation, provider admission, and per-host budget |
| Exchange candidates | Every Hub-coordinated host, after assessment | Hub coordinates in `convergence-owner-host.json` |
| Apply a candidate | Convergence owner (`knowledgeOutputCommitGrant`), committing as `Lervo Knowledge` | ADR-0466 owner fence and the existing instruction plan gate |
| Reject a candidate | Any host | None |

After candidate exchange, the convergence owner automatically applies eligible owner-stated `explicit_user` rules. These candidates require no owner or agent review command. Application still requires current catalog bindings and a ready plan with matching rule, target, and bytes. Held items retain their resolution path. See the [current owner-turn capture delivery contract](../../../roadmap/open-collaboration-platform/delivery-sequence.md#owner-turn-instruction-capture-evidence).

## Exchange sequence

`exchangeInstructionCandidates` in `packages/repository-knowledge-runtime/src/instruction-candidate-exchange.ts` runs these steps in order:

1. Publish this host's pending resolutions (`applied` or `rejected`), recorded by the apply path before removing the local candidate.
2. Read the Hub list. A resolved record removes the matching local candidate and is remembered to prevent reimport. An open record absent from this host is validated with `validateDurableInstructionCandidate` and stored, unless the generated rule already exists with identical bytes.
3. Publish this host's own open candidates not yet listed by the Hub.

Host-local bookkeeping is stored in `.lervo/state/knowledge/instruction-capture/exchange.json`, bounded to 128 known hashes, 128 resolved hashes, and 16 pending resolutions. A Hub failure preserves bookkeeping and retries every step next cycle.

A host without delegation sets `authorityBlocked` in `state.json`, projecting one `instruction_capture_blocked` Lervo-debt item (`requiresUserAction: false`, ADR-0561) and the compact line `Instruction capture (Lervo debt, no owner action): N owner turns wait for assessment on this host because it has no knowledge convergence delegation`.

On a Hub-coordinated host that does not own convergence, the candidate line reads `… await automatic apply on the convergence owner host (<label>)`. Without Hub coordination, exchange reports `standalone`, and the resident applies locally without committing.

## Hub contract

The route is `GET|POST /v1/sync/projects/{projectId}/knowledge-instruction-candidates?destinationId=…&projectIdentityHash=…` with `workspace.read` and `workspace.coordinate`, or `sync.write` under [ADR-0469](../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md#hub-permission-for-knowledge-coordination). Project scope checks remain unchanged. This permission alternative applies to the knowledge coordination routes and does not grant workspace reservation authority.

The Hub stores one row per repository and proposed Markdown hash in `hub_knowledge_instruction_candidates`, retaining at most 64 per repository. `mergeKnowledgeInstructionCandidateRecord` keeps the first record, allows a resolution to replace an open record once, and never lets an open publish reopen a resolved rule.

## Verification boundary

The current delivery record reports cross-host exchange tests against a fake Hub and the real Hub route, but no exchange between installed Mac and WSL hosts. Installed verification of the owner's 2026-11-01 rule applying on WSL and reaching Mac through publication remains open. These contracts do not establish installed cross-host completion.
