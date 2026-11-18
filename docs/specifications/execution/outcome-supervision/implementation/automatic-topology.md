# Automatic assignment topology

`AutomaticTopologyEffectV1` binds one structural topology request and plan to the worker's exact responsibility, provider and token reservation. Its versioned policy review is distinct from manual topology v2 approval. The adapter derives operating-effect scope from the payload, compares it with the canonical action plan, and requires a recorded admitted operating-policy decision before writing an assignment. Neither a model proposal nor a structural approval hash alone grants authority.

## Materialization and claim

`SupervisionTopologyMaterializer` holds the existing assignment-graph lock, compares a freshly observed structural plan, and invokes current effect admission before and after assignment creation. The assignment starts `blocked` at revision 1. Its `assignment.created` evidence commits under the current supervision owner fence. Recorder failure restores assignment bytes through the existing workforce transition. Interruption between filesystem write and event commit remains uncertain and requires inspection.

Automatic assignments remain blocked until `SupervisionResponsibilityClaimer` binds the responsibility and claims revision 2 in one fenced event transaction. Ordinary claim and manual topology-activation paths reject automatic assignments. No queued interval exposes work without its responsibility. The storage binding validates the exact resulting claim; the fenced recorder separately owns canonical predecessor, mandate, deadline and effect admission. Claiming does not start a provider.

Each automatic decision adds one node. Later decisions can extend branches and joins through existing dependencies. ADR-0560 removed the manual v2 multi-node CLI path. Automatic v1 rejects nodes with explicit manual approval requirements; policy review cannot satisfy them.

## Evidence, privacy and recovery

Automatic provenance includes `policyReview` schema 1, the operating decision ID and exact recorded review hash. Its reviewer digest identifies the operating policy, never a fabricated human reviewer. `assignment.created` adds `topologyPolicyReviewVersion`, `topologyPolicyDecisionId` and `topologyPolicyReviewHash` in event envelope 3. All three fields are required together. Topology history rejects older envelopes or conflicting policy coordinates. Task prose, paths and provider output remain outside these event fields.

Inspection compares canonical assignment content and provenance with the exact recorded decision and creation event:

- An exact match proves materialization even after the assignment advances to execution.
- Both assignment and event absent means not started.
- Only one present, changed content, or conflicting evidence means uncertain.

Inspection never grants a new lease. For changed-source plans only, fenced absence inspection can record [decision supersession](recovery/decisions-and-replay.md); executed or partially recorded effects cannot use this path. Exact replay returns existing evidence without another creation. Manual approval cannot resume an automatic policy decision.

The default Node runtime observes the actual structural plan, role contract, executor ancestry, path scope, live leases, task sources and resource limits before materialization. It routes the exact automatic topology contract to the built-in fenced adapter. The adapter rechecks the admitted authority/task digest, canonical graph inputs and workforce evidence around assignment creation. A changed role, conflicting lease, concurrent assignment change or advancing event head rejects the transition. Recorded automatic topology effects use built-in inspection and absence-based supersession.

The blocked assignment can acquire its [canonical responsibility and lease](responsibility-claims.md) in a separate operating decision. These transitions do not establish model-generated planning, provider dispatch or installed acceptance.

## Verification

Tests cover policy-bound blocked creation, ordinary-claim and manual-activation rejection, exact responsibility claim, replay after claim, changed graph or effect scope, authority loss before and after creation, event failure rollback and owner-fence loss.

The Node composition fixture uses actual repository admission to create one blocked assignment, then binds its responsibility and lease. It recovers the same claim from canonical events without another acquisition. Fixture-authored proposals do not prove production model planning.

Supervision projection retains unbound assignment IDs during planning and cancellation. A claimed responsibility without dispatch evidence requests dispatch rather than waiting indefinitely for a start event.
