import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import { adapterContractMessageSchema } from "./adapter.js";
import { contextEvidenceSchema } from "./context-evidence.js";
import { deliberationArtifactSchema } from "./deliberation-artifact.js";
import {
  deliberationArtifactRecordedEventPayloadSchema,
  deliberationCompletedEventPayloadSchema,
  deliberationStartedEventPayloadSchema,
} from "./deliberation-event.js";
import { deliberationOutcomeSchema } from "./deliberation-outcome.js";
import { deliberationPolicySchema } from "./deliberation-policy.js";
import { documentManifestSchema } from "./document-manifest.js";
import {
  documentMigrationAppliedEventPayloadSchema,
  documentMigrationApplyReceiptSchema,
  documentMigrationApprovalSchema,
} from "./document-migration-apply.js";
import {
  documentMigrationCandidateArtifactSchema,
  documentMigrationCandidateSchema,
  documentMigrationPlanSchema,
} from "./document-migration.js";
import { documentRegistrySchema } from "./document-registry.js";
import { documentStalenessResultSchema } from "./document-staleness.js";
import { eventEnvelopeSchema } from "./event.js";
import {
  legacyRegistryEntryArtifactSchema,
  legacyRegistryMigrationPlanSchema,
} from "./legacy-registry-migration.js";
import {
  legacyRegistryMigrationAppliedEventPayloadSchema,
  legacyRegistryMigrationApplyReceiptSchema,
  legacyRegistryMigrationApprovalSchema,
} from "./legacy-registry-migration-apply.js";
import {
  managedBlockPatchCandidateArtifactSchema,
  managedBlockPatchCandidateSchema,
} from "./managed-block-patch.js";
import { knowledgeCandidateSchema } from "./knowledge.js";
import {
  knowledgeCandidateCreatedEventPayloadSchema,
  knowledgeCandidateReviewedEventPayloadSchema,
  knowledgeStaleDetectedEventPayloadSchema,
  knowledgeVerifiedEventPayloadSchema,
} from "./knowledge-event.js";
import {
  knowledgePromotionPolicySchema,
  knowledgeReviewApprovalSchema,
  knowledgeStalenessResultSchema,
  verifiedKnowledgeSchema,
} from "./knowledge-lifecycle.js";
import { projectManifestSchema } from "./project.js";
import { roleProfileSchema } from "./role.js";
import { runCompletedEventPayloadSchema } from "./run-event.js";
import { handoffBundleSchema, sharedContextPublicationSchema } from "./shared-context.js";
import { skillManifestSchema } from "./skill.js";
import { skillLockSchema } from "./skill-lock.js";
import { verificationResultSchema, verificationSuiteSchema } from "./verification.js";
import {
  verificationCompletedEventPayloadSchema,
  verificationStartedEventPayloadSchema,
} from "./verification-event.js";
import { writingContractSchema } from "./writing.js";
import { writingEvaluationSchema } from "./writing-evaluation.js";
import { writingPublicationPermitSchema } from "./writing-publication.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});
ajv.addSchema(documentManifestSchema);

const validators = {
  project: ajv.compile(projectManifestSchema),
  event: ajv.compile(eventEnvelopeSchema),
  legacyRegistryEntryArtifact: ajv.compile(legacyRegistryEntryArtifactSchema),
  legacyRegistryMigrationPlan: ajv.compile(legacyRegistryMigrationPlanSchema),
  legacyRegistryMigrationApproval: ajv.compile(legacyRegistryMigrationApprovalSchema),
  legacyRegistryMigrationAppliedEventPayload: ajv.compile(
    legacyRegistryMigrationAppliedEventPayloadSchema,
  ),
  legacyRegistryMigrationApplyReceipt: ajv.compile(
    legacyRegistryMigrationApplyReceiptSchema,
  ),
  contextEvidence: ajv.compile(contextEvidenceSchema),
  deliberationPolicy: ajv.compile(deliberationPolicySchema),
  deliberationArtifact: ajv.compile(deliberationArtifactSchema),
  deliberationOutcome: ajv.compile(deliberationOutcomeSchema),
  deliberationStartedEventPayload: ajv.compile(deliberationStartedEventPayloadSchema),
  deliberationArtifactRecordedEventPayload: ajv.compile(
    deliberationArtifactRecordedEventPayloadSchema,
  ),
  deliberationCompletedEventPayload: ajv.compile(deliberationCompletedEventPayloadSchema),
  adapter: ajv.compile(adapterContractMessageSchema),
  role: ajv.compile(roleProfileSchema),
  runCompletedEventPayload: ajv.compile(runCompletedEventPayloadSchema),
  sharedContext: ajv.compile(sharedContextPublicationSchema),
  handoffBundle: ajv.compile(handoffBundleSchema),
  skill: ajv.compile(skillManifestSchema),
  skillLock: ajv.compile(skillLockSchema),
  documentRegistry: ajv.compile(documentRegistrySchema),
  documentStalenessResult: ajv.compile(documentStalenessResultSchema),
  documentManifest: ajv.getSchema(documentManifestSchema.$id)!,
  documentMigrationApproval: ajv.compile(documentMigrationApprovalSchema),
  documentMigrationAppliedEventPayload: ajv.compile(
    documentMigrationAppliedEventPayloadSchema,
  ),
  documentMigrationApplyReceipt: ajv.compile(documentMigrationApplyReceiptSchema),
  documentMigrationCandidate: ajv.compile(documentMigrationCandidateSchema),
  documentMigrationCandidateArtifact: ajv.compile(documentMigrationCandidateArtifactSchema),
  documentMigrationPlan: ajv.compile(documentMigrationPlanSchema),
  managedBlockPatchCandidate: ajv.compile(managedBlockPatchCandidateSchema),
  managedBlockPatchCandidateArtifact: ajv.compile(managedBlockPatchCandidateArtifactSchema),
  knowledgeCandidate: ajv.compile(knowledgeCandidateSchema),
  knowledgePromotionPolicy: ajv.compile(knowledgePromotionPolicySchema),
  knowledgeReviewApproval: ajv.compile(knowledgeReviewApprovalSchema),
  verifiedKnowledge: ajv.compile(verifiedKnowledgeSchema),
  knowledgeStalenessResult: ajv.compile(knowledgeStalenessResultSchema),
  knowledgeCandidateCreatedEventPayload: ajv.compile(
    knowledgeCandidateCreatedEventPayloadSchema,
  ),
  knowledgeCandidateReviewedEventPayload: ajv.compile(
    knowledgeCandidateReviewedEventPayloadSchema,
  ),
  knowledgeVerifiedEventPayload: ajv.compile(knowledgeVerifiedEventPayloadSchema),
  knowledgeStaleDetectedEventPayload: ajv.compile(
    knowledgeStaleDetectedEventPayloadSchema,
  ),
  writingContract: ajv.compile(writingContractSchema),
  writingEvaluation: ajv.compile(writingEvaluationSchema),
  writingPublicationPermit: ajv.compile(writingPublicationPermitSchema),
  verificationSuite: ajv.compile(verificationSuiteSchema),
  verificationResult: ajv.compile(verificationResultSchema),
  verificationStartedEventPayload: ajv.compile(verificationStartedEventPayloadSchema),
  verificationCompletedEventPayload: ajv.compile(
    verificationCompletedEventPayloadSchema,
  ),
} satisfies Record<string, ValidateFunction>;

export type SchemaName = keyof typeof validators;

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ErrorObject[] };

export function validateSchema(name: SchemaName, value: unknown): ValidationResult {
  const validator = validators[name];
  if (validator(value)) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: validator.errors ? [...validator.errors] : [],
  };
}
