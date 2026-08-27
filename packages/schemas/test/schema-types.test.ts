import type {
  CapabilityDecision,
  PolicyApproval,
  PolicyApprovalRevocation,
  PolicySnapshot,
  DeliberationArtifactRecordedEventPayload,
  DeliberationCompletedEventPayload,
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
  DocumentRecord,
  DocumentRegistry,
  DocumentManifest,
  DocumentMigrationApproval,
  DocumentMigrationApplyReceipt,
  DocumentMigrationCandidate,
  DocumentMigrationPlan,
  DocumentStalenessResult,
  EventEnvelope,
  HandoffBundle,
  LegacyRegistryEntryArtifact,
  LegacyRegistryMigrationApplyReceipt,
  LegacyRegistryMigrationApproval,
  LegacyRegistryMigrationPlan,
  ManagedBlockPatchCandidate,
  KnowledgePromotionPolicy,
  KnowledgeReviewApproval,
  KnowledgeStalenessResult,
  EventSyncAcknowledgement,
  OutboundEventBatch,
  ProjectRegistrationRequest,
  RemoteCommand,
  RemoteCommandDeliveryAcknowledgement,
  RemoteCommandDeliveryConfirmation,
  RemoteCommandExecutionReceipt,
  RemoteCommandLease,
  RoleProfile,
  RoleEvaluationBundle,
  RoleEvaluationResult,
  HighRiskRoleWorkflow,
  SharedContextPublication,
  SkillManifest,
  VerificationResult,
  VerificationSuite,
  WritingPublicationPermit,
  VerifiedKnowledge,
  ConversationAdapterDescriptor,
  ConversationInboundEvent,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
  ConversationOutboundMessage,
  TraceCapabilitiesReport,
  OrganizationDeploymentPolicy,
  OrganizationFleetRolloutApproval,
  OrganizationFleetRolloutPlan,
  OrganizationFleetWaveObservation,
  OrganizationNodeEnrollment,
  OrganizationNodeRolloutExecutionPlan,
  OrganizationNodeRolloutExecutionReceipt,
  OrganizationNodeRolloutDelivery,
  OrganizationNodeRolloutDeliveryReceipt,
  OrganizationNodeRolloutRecoveryObservation,
  OrganizationNodeRolloutRecoveryReceipt,
  OrganizationNodeRolloutRollbackPlan,
  OrganizationNodeRolloutRollbackReceipt,
  OrganizationRuntimeCredentialDeliveryReceipt,
  SignedOrganizationDeploymentPolicy,
  SignedOrganizationNodeRolloutDelivery,
  OrganizationNodeRollbackDelivery,
  OrganizationNodeRollbackDeliveryReceipt,
  OrganizationNodeRollbackRecoveryReceipt,
  SignedOrganizationNodeRollbackDelivery,
} from "../src/index.js";
import { describe, expectTypeOf, it } from "vitest";

describe("schema-derived TypeScript contracts", () => {
  it("keeps trace capability modes and deprecations machine-readable", () => {
    expectTypeOf<TraceCapabilitiesReport["defaultMode"]>().toEqualTypeOf<
      "implicit_full" | "full" | "page" | "cursor"
    >();
    expectTypeOf<TraceCapabilitiesReport["modes"][number]["reportKind"]>().toEqualTypeOf<
      "full" | "page"
    >();
    expectTypeOf<TraceCapabilitiesReport["deprecations"][number]["code"]>().toEqualTypeOf<string>();
  });

  it("keeps every role capability decision explicit", () => {
    expectTypeOf<RoleProfile["capabilities"]["deploy"]>().toEqualTypeOf<CapabilityDecision>();
    expectTypeOf<RoleProfile["contextPolicy"]["minimumAssurance"]>().toEqualTypeOf<"E3">();
    expectTypeOf<RoleProfile["outputContract"]["presentation"]>().toMatchTypeOf<
      | { audience: "machine"; writingPolicyId: null }
      | { audience: "human" | "mixed"; locale: string; writingPolicyId: string }
    >();
  });

  it("separates role evaluation configuration, evidence result and high-risk workflow", () => {
    expectTypeOf<
      RoleEvaluationBundle["highRiskDisposition"]
    >().toEqualTypeOf<"deliberation_required">();
    expectTypeOf<RoleEvaluationResult["overallStatus"]>().toEqualTypeOf<
      "passed" | "failed" | "incomplete"
    >();
    expectTypeOf<HighRiskRoleWorkflow["risk"]>().toEqualTypeOf<"high">();
    expectTypeOf<HighRiskRoleWorkflow["deliberationPolicy"]>().toEqualTypeOf<DeliberationPolicy>();
  });

  it("derives policy deployment and approval lifecycle types from schemas", () => {
    expectTypeOf<PolicySnapshot["rules"][number]["decision"]>().toEqualTypeOf<CapabilityDecision>();
    expectTypeOf<PolicyApproval["snapshotId"]>().toEqualTypeOf<string>();
    expectTypeOf<PolicyApprovalRevocation["approvalId"]>().toEqualTypeOf<string>();
  });

  it("keeps organization authority, runtime secrets, and delivery evidence separate", () => {
    expectTypeOf<
      OrganizationDeploymentPolicy["credentialPolicy"]["deliveryMode"]
    >().toEqualTypeOf<"runtime_only">();
    expectTypeOf<
      OrganizationRuntimeCredentialDeliveryReceipt["secretMaterial"]
    >().toEqualTypeOf<"excluded">();
    expectTypeOf<
      SignedOrganizationDeploymentPolicy["signature"]["algorithm"]
    >().toEqualTypeOf<"ed25519">();
  });

  it("keeps organization fleet plans, observations, approvals, and effects distinct", () => {
    expectTypeOf<OrganizationNodeEnrollment["secretMaterial"]>().toEqualTypeOf<"excluded">();
    expectTypeOf<
      OrganizationFleetRolloutPlan["effect"]["deployment"]
    >().toEqualTypeOf<"not_executed">();
    expectTypeOf<
      OrganizationFleetWaveObservation["effect"]["decision"]
    >().toEqualTypeOf<"not_selected">();
    expectTypeOf<
      OrganizationFleetRolloutApproval["effect"]["approval"]
    >().toEqualTypeOf<"granted">();
    expectTypeOf<
      OrganizationNodeRolloutExecutionPlan["effect"]["deployment"]
    >().toEqualTypeOf<"not_executed">();
    expectTypeOf<
      OrganizationNodeRolloutExecutionReceipt["effect"]["deployment"]
    >().toEqualTypeOf<"executed">();
  });

  it("keeps signed rollout delivery separate from its local execution effect", () => {
    expectTypeOf<
      OrganizationNodeRolloutDelivery["effect"]["deployment"]
    >().toEqualTypeOf<"not_executed">();
    expectTypeOf<
      SignedOrganizationNodeRolloutDelivery["signature"]["algorithm"]
    >().toEqualTypeOf<"ed25519">();
    expectTypeOf<
      OrganizationNodeRolloutDeliveryReceipt["effect"]["deployment"]
    >().toEqualTypeOf<"executed">();
    expectTypeOf<OrganizationNodeRolloutRecoveryReceipt["classification"]>().toEqualTypeOf<
      "applied" | "not_applied" | "unknown"
    >();
    expectTypeOf<
      OrganizationNodeRolloutRecoveryReceipt["effect"]["deployment"]
    >().toEqualTypeOf<"not_executed">();
    expectTypeOf<
      OrganizationNodeRolloutRecoveryObservation["privacy"]["absolutePaths"]
    >().toEqualTypeOf<"excluded">();
  });

  it("keeps predecessor-bound rollback planning separate from rollback effect", () => {
    expectTypeOf<OrganizationNodeRolloutRollbackPlan["action"]>().toEqualTypeOf<"rollback_wave">();
    expectTypeOf<
      OrganizationNodeRolloutRollbackPlan["effect"]["rollback"]
    >().toEqualTypeOf<"not_executed">();
    expectTypeOf<
      OrganizationNodeRolloutRollbackReceipt["effect"]["rollback"]
    >().toEqualTypeOf<"executed">();
    expectTypeOf<
      OrganizationNodeRollbackDelivery["effect"]["rollback"]
    >().toEqualTypeOf<"not_executed">();
    expectTypeOf<
      SignedOrganizationNodeRollbackDelivery["signature"]["algorithm"]
    >().toEqualTypeOf<"ed25519">();
    expectTypeOf<
      OrganizationNodeRollbackDeliveryReceipt["effect"]["rollback"]
    >().toEqualTypeOf<"executed">();
    expectTypeOf<OrganizationNodeRollbackRecoveryReceipt["classification"]>().toEqualTypeOf<
      "rolled_back" | "not_rolled_back" | "unknown"
    >();
  });

  it("keeps skill trust as a discriminated union", () => {
    type VerifiedSkill = Extract<SkillManifest["trust"], { level: "verified" }>;
    expectTypeOf<VerifiedSkill["signatureStatus"]>().toEqualTypeOf<"valid">();
  });

  it("types document ids as a map of document records", () => {
    expectTypeOf<DocumentRegistry["documents"]>().toMatchTypeOf<Record<string, DocumentRecord>>();
  });

  it("keeps document ownership and bounded content policy aligned", () => {
    type GeneratedManifest = DocumentManifest & {
      record: { ownership: { mode: "lervo_generated" } };
      contentPolicy: { mode: "lervo_generated" };
    };
    expectTypeOf<
      GeneratedManifest["contentPolicy"]["historyMode"]
    >().toEqualTypeOf<"separate_documents">();
    expectTypeOf<GeneratedManifest["contentPolicy"]["maxDocumentBytes"]>().toEqualTypeOf<65536>();
  });

  it("keeps migration discovery read-only and source-hash bound", () => {
    expectTypeOf<DocumentMigrationPlan["writesAllowed"]>().toEqualTypeOf<false>();
    expectTypeOf<DocumentMigrationPlan["mode"]>().toEqualTypeOf<"dry_run">();
    expectTypeOf<DocumentMigrationCandidate["source"]["contentHash"]>().toEqualTypeOf<string>();
  });

  it("keeps managed block patch candidates review-only and byte-hash bound", () => {
    expectTypeOf<ManagedBlockPatchCandidate["writesAllowed"]>().toEqualTypeOf<false>();
    expectTypeOf<
      ManagedBlockPatchCandidate["target"]["markerFamily"]
    >().toEqualTypeOf<"lervo_v1">();
    expectTypeOf<
      ManagedBlockPatchCandidate["assurances"]["onlyTargetContentChanged"]
    >().toEqualTypeOf<true>();
  });

  it("keeps unknown document staleness separate from current and stale", () => {
    expectTypeOf<DocumentStalenessResult["status"]>().toEqualTypeOf<
      "current" | "stale" | "unknown"
    >();
    expectTypeOf<DocumentStalenessResult["signals"]["managedInputs"]["status"]>().toEqualTypeOf<
      "not_applicable" | "current" | "stale" | "unknown"
    >();
  });

  it("keeps knowledge review, verified evidence, and stale signals separate", () => {
    expectTypeOf<KnowledgePromotionPolicy["requireHumanReviewer"]>().toEqualTypeOf<true>();
    expectTypeOf<KnowledgeReviewApproval["decision"]>().toEqualTypeOf<"approved" | "rejected">();
    expectTypeOf<VerifiedKnowledge["status"]>().toEqualTypeOf<"verified">();
    expectTypeOf<KnowledgeStalenessResult["status"]>().toEqualTypeOf<"current" | "stale">();
  });

  it("keeps verification commands separate from observed command results", () => {
    expectTypeOf<VerificationSuite["commands"][number]["executable"]>().toEqualTypeOf<string>();
    expectTypeOf<VerificationResult["commands"][number]["status"]>().toEqualTypeOf<
      | "passed"
      | "failed"
      | "timed_out"
      | "output_limit_exceeded"
      | "execution_error"
      | "cancelled"
      | "not_run"
    >();
  });

  it("keeps Hub registration, event batches, and durable acknowledgements separate", () => {
    expectTypeOf<
      ProjectRegistrationRequest["syncPolicy"]["artifactMode"]
    >().toEqualTypeOf<"none">();
    expectTypeOf<OutboundEventBatch["events"][number]>().toEqualTypeOf<EventEnvelope>();
    expectTypeOf<EventSyncAcknowledgement["status"]>().toEqualTypeOf<"accepted" | "duplicate">();
  });

  it("keeps remote request content referenced and execution outcomes terminal", () => {
    expectTypeOf<RemoteCommand["action"]["kind"]>().toEqualTypeOf<"managed_run">();
    expectTypeOf<RemoteCommand["action"]["request"]>().toMatchTypeOf<{
      artifactId: string;
      contentHash: string;
      byteCount: number;
    }>();
    expectTypeOf<RemoteCommandExecutionReceipt["outcome"]>().toEqualTypeOf<"executed" | "failed">();
  });

  it("separates command lease, Node acknowledgement, and Hub confirmation states", () => {
    expectTypeOf<RemoteCommandLease["envelope"]["command"]>().toEqualTypeOf<RemoteCommand>();
    expectTypeOf<RemoteCommandDeliveryAcknowledgement["disposition"]>().toEqualTypeOf<
      "completed" | "rejected"
    >();
    expectTypeOf<RemoteCommandDeliveryConfirmation["status"]>().toEqualTypeOf<
      "accepted" | "duplicate"
    >();
  });

  it("binds a writing publication permit to policy, evaluation, content, and surface", () => {
    expectTypeOf<WritingPublicationPermit["surface"]>().toEqualTypeOf<
      | "readme"
      | "pull_request"
      | "issue"
      | "review_comment"
      | "status"
      | "chat"
      | "documentation"
      | "commit"
      | "code_comment"
    >();
    expectTypeOf<WritingPublicationPermit["evaluationHash"]>().toEqualTypeOf<string>();
  });

  it("keeps deliberation artifacts and terminal outcomes discriminated", () => {
    type Objection = Extract<DeliberationArtifact, { kind: "objection" }>;
    type Converged = Extract<DeliberationOutcome, { status: "converged" }>;
    expectTypeOf<Objection["details"]["reviewStatus"]>().toEqualTypeOf<
      "approved" | "changes_requested"
    >();
    type Verification = Extract<DeliberationArtifact, { kind: "verification" }>;
    expectTypeOf<Verification["details"]["targetClaims"][number]>().toEqualTypeOf<{
      claimId: string;
      claimDigest: string;
    }>();
    expectTypeOf<Converged["failure"]>().toEqualTypeOf<null>();
    expectTypeOf<
      DeliberationPolicy["convergence"]["requireIndependentSessions"]
    >().toEqualTypeOf<true>();
    type CompletedFailure = Extract<DeliberationCompletedEventPayload, { status: "failed" }>;
    expectTypeOf<CompletedFailure["failurePhase"]>().toEqualTypeOf<
      "provider" | "context" | "telemetry" | "artifact" | "writing" | "verification" | "contract"
    >();
    expectTypeOf<DeliberationArtifactRecordedEventPayload["kind"]>().toEqualTypeOf<
      "proposal" | "objection" | "revision" | "verification" | "decision"
    >();
  });

  it("requires reviewed sidecars and returns a hash-only apply event payload", () => {
    type Approved = Extract<
      DocumentMigrationApproval["decisions"][number],
      { action: "approve_sidecar" }
    >;
    expectTypeOf<Approved["manifest"]>().toEqualTypeOf<DocumentManifest>();
    expectTypeOf<
      DocumentMigrationApplyReceipt["eventPayload"]["approvalDigest"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      DocumentMigrationApplyReceipt["eventPayload"]["afterLayoutHash"]
    >().toEqualTypeOf<string>();
  });

  it("keeps legacy registry migration read-only and preserves each original record", () => {
    expectTypeOf<LegacyRegistryMigrationPlan["writesAllowed"]>().toEqualTypeOf<false>();
    expectTypeOf<
      LegacyRegistryMigrationPlan["source"]["deactivationAction"]
    >().toEqualTypeOf<"archive_then_remove">();
    expectTypeOf<LegacyRegistryEntryArtifact["record"]>().toEqualTypeOf<DocumentRecord>();
    type Approved = Extract<
      LegacyRegistryMigrationApproval["decisions"][number],
      { action: "approve_sidecar" }
    >;
    expectTypeOf<Approved["manifest"]>().toEqualTypeOf<DocumentManifest>();
    expectTypeOf<
      LegacyRegistryMigrationApplyReceipt["eventPayload"]["migrationKind"]
    >().toEqualTypeOf<"legacy_registry_structural">();
  });

  it("keeps shared context origin and handoff coordinates explicit", () => {
    type AgentPublication = SharedContextPublication & {
      producer: { kind: "agent" };
    };
    expectTypeOf<AgentPublication["producer"]>().toMatchTypeOf<{
      roleId: string;
      runId: string;
      sessionId: string;
    }>();
    expectTypeOf<HandoffBundle["from"]["contextGeneration"]>().toEqualTypeOf<number>();
    expectTypeOf<RoleProfile["handoff"]["sharedContextRequired"]>().toEqualTypeOf<true>();
  });

  it("keeps platform adapters, participation, and verified replies separate", () => {
    expectTypeOf<ConversationAdapterDescriptor["adapterKind"]>().toEqualTypeOf<string>();
    expectTypeOf<ConversationInboundEvent["sourceEventKeyHash"]>().toEqualTypeOf<string>();
    expectTypeOf<ConversationParticipationPolicy["mode"]>().toEqualTypeOf<
      "mention_only" | "relevant" | "proactive" | "silent"
    >();
    expectTypeOf<ConversationParticipationDecision["action"]>().toEqualTypeOf<
      "observe" | "respond"
    >();
    expectTypeOf<ConversationOutboundMessage["publicationPermit"]["surface"]>().toEqualTypeOf<
      WritingPublicationPermit["surface"]
    >();
  });
});
