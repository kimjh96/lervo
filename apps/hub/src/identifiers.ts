import {
  projectIdSchema,
  runIdSchema,
  syncDestinationIdSchema,
  workIdSchema,
} from "@lervo/schemas";

export const HUB_PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
export const HUB_DESTINATION_ID_PATTERN = new RegExp(syncDestinationIdSchema.pattern);
export const HUB_PROJECT_ID_PATTERN = new RegExp(projectIdSchema.pattern);
export const HUB_RUN_ID_PATTERN = new RegExp(runIdSchema.pattern);
export const HUB_WORK_ID_PATTERN = new RegExp(workIdSchema.pattern);
