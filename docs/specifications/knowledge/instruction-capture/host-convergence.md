# Instruction-capture host convergence

Capture behaves identically on every host, regardless of who holds the [ADR-0466](../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) convergence owner lease.

## Execution and gates

| Step | Where it runs | Gate |
| --- | --- | --- |
| Queue an owner turn | Host whose hook or conversation runtime observed it | None |
| Assess the turn | Same host, in `runOwnerTurnCaptureWork` on every resident cycle, owner or not | Host's delegation, provider admission, and per-host budget |
| Exchange candidates | Every Hub-coordinated host, after assessment | Hub coordinates in `convergence-owner-host.json` |
| Apply a candidate | Convergence owner (`knowledgeOutputCommitGrant`), committing as `Lervo Knowledge` | ADR-0466 owner fence |
| Reject a candidate | Any host | None |

## Exchange sequence

`exchangeInstructionCandidates` in `packages/repository-knowledge-runtime/src/instruction-candidate-exchange.ts` runs these steps in order:

1. Publish this host's pending resolutions (`applied` or `rejected`), recorded by `lervo knowledge instruction review` before removing the local candidate.
2. Read the Hub list. A resolved record removes the matching local candidate and is remembered to prevent reimport. An open record absent from this host is validated with `validateDurableInstructionCandidate` and stored, unless the generated rule already exists with identical bytes.
3. Publish this host's own open candidates not yet listed by the Hub.

Host-local bookkeeping is stored in `.lervo/state/knowledge/instruction-capture/exchange.json`, bounded to 128 known hashes, 128 resolved hashes, and 16 pending resolutions. A Hub failure preserves bookkeeping and retries every step next cycle.

A host without delegation sets `authorityBlocked` in `state.json`, projecting one `instruction_capture_blocked` attention item and the compact line `Instruction capture: N owner turns cannot be assessed on this host because it has no knowledge convergence delegation`.

On a Hub-coordinated host that does not own convergence, the candidate line reads `… await review on the convergence owner host (<label>)`. Without Hub coordination, exchange reports `standalone`, and review applies locally without committing.

## Hub contract

The route is `GET|POST /v1/sync/projects/{projectId}/knowledge-instruction-candidates?destinationId=…&projectIdentityHash=…` with `workspace.read` and `workspace.coordinate`.

The Hub stores one row per repository and proposed Markdown hash in `hub_knowledge_instruction_candidates`, retaining at most 64 per repository. `mergeKnowledgeInstructionCandidateRecord` keeps the first record, allows a resolution to replace an open record once, and never lets an open publish reopen a resolved rule.
