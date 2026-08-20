import type { FromSchema } from "json-schema-to-ts";

import {
  highRiskRoleWorkflowIdSchema,
  projectIdSchema,
  roleEvaluationBundleIdSchema,
  roleIdSchema,
  schemaVersionSchema,
  sha256Schema,
} from "./common.js";
import { deliberationPolicySchema, deliberationResponsibilities } from "./deliberation-policy.js";

const roleBindingSchema = {
  type: "object",
  properties: {
    roleId: roleIdSchema,
    roleProfileHash: sha256Schema,
    evaluationBundleId: roleEvaluationBundleIdSchema,
    evaluationBundleHash: sha256Schema,
    responsibilities: {
      type: "array",
      items: { type: "string", enum: deliberationResponsibilities },
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: [
    "roleId",
    "roleProfileHash",
    "evaluationBundleId",
    "evaluationBundleHash",
    "responsibilities",
  ],
  additionalProperties: false,
} as const;

export const highRiskRoleWorkflowSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/high-risk-role-workflow.schema.json",
  title: "Lervo high-risk cross-role workflow",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    workflowId: highRiskRoleWorkflowIdSchema,
    projectId: projectIdSchema,
    risk: { const: "high" },
    primaryRoleId: roleIdSchema,
    roleBindings: {
      type: "array",
      items: roleBindingSchema,
      minItems: 3,
      maxItems: 16,
    },
    deliberationPolicy: { $ref: deliberationPolicySchema.$id },
  },
  required: [
    "schemaVersion",
    "workflowId",
    "projectId",
    "risk",
    "primaryRoleId",
    "roleBindings",
    "deliberationPolicy",
  ],
  additionalProperties: false,
} as const;

export type HighRiskRoleWorkflow = FromSchema<
  typeof highRiskRoleWorkflowSchema,
  { references: [typeof deliberationPolicySchema] }
>;
