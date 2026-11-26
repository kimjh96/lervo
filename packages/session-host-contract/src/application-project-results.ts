/**
 * The results of the project commands of the core link (Lervo ADE projects, "Core link"): adding
 * a project, its display name and mark, unregistering it, and the projects location.
 */
import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

const nameSchema = { type: "string", minLength: 1, maxLength: 256 } as const;
const rootSchema = { type: "string", minLength: 1, maxLength: 4096 } as const;

/** A project's mark: its image, named by the SHA-256 of its bytes (Lervo ADE projects). */
export const projectMarkSchema = {
  title: "ProjectMark",
  type: "object",
  required: ["sha256", "mediaType"],
  properties: {
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    mediaType: { enum: ["image/png", "image/jpeg", "image/webp"] },
  },
} as const;

export const projectMarkOrNullSchema = { anyOf: [projectMarkSchema, { type: "null" }] } as const;

const projectIdOnly = { projectId: identifierSchema } as const;

/** `project.add`: the project the core added and registered, and what it set up. */
export const projectAddResultSchema = {
  title: "ProjectAddResult",
  type: "object",
  required: ["projectId", "name", "displayName", "root", "source"],
  properties: {
    ...projectIdOnly,
    name: nameSchema,
    displayName: nameSchema,
    root: rootSchema,
    source: { enum: ["folder", "clone", "new"] },
    gitInitialized: { type: "boolean" },
    lervoInitialized: { type: "boolean" },
  },
} as const;

/** `project.rename`: the project's display name after the change. */
export const projectRenameResultSchema = {
  title: "ProjectRenameResult",
  type: "object",
  required: ["projectId", "displayName"],
  properties: { ...projectIdOnly, displayName: nameSchema },
} as const;

/** `project.mark.set`: the mark the project now has. */
export const projectMarkSetResultSchema = {
  title: "ProjectMarkSetResult",
  type: "object",
  required: ["projectId", "mark"],
  properties: { ...projectIdOnly, mark: projectMarkSchema },
} as const;

/** `project.mark.clear`: the project shows its first letter again. */
export const projectMarkClearResultSchema = {
  title: "ProjectMarkClearResult",
  type: "object",
  required: ["projectId"],
  properties: projectIdOnly,
} as const;

/** `project.mark.read`: the mark's image as Base64, or null when the project has none. */
export const projectMarkReadResultSchema = {
  title: "ProjectMarkReadResult",
  type: "object",
  required: ["projectId", "image"],
  properties: {
    ...projectIdOnly,
    image: {
      anyOf: [
        {
          type: "object",
          required: ["sha256", "mediaType", "data"],
          properties: {
            sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
            mediaType: { enum: ["image/png", "image/jpeg", "image/webp"] },
            data: { type: "string", maxLength: 700_000 },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

/** `project.unregister`: this host no longer lists the project; its files stay. */
export const projectUnregisterResultSchema = {
  title: "ProjectUnregisterResult",
  type: "object",
  required: ["projectId"],
  properties: projectIdOnly,
} as const;

/** `projects.location`: where clones and new projects go, after any change. */
export const projectsLocationResultSchema = {
  title: "ProjectsLocationResult",
  type: "object",
  required: ["path"],
  properties: { path: rootSchema },
} as const;

export type ProjectMark = FromSchema<typeof projectMarkSchema>;
export type ProjectAddResult = FromSchema<typeof projectAddResultSchema>;
export type ProjectRenameResult = FromSchema<typeof projectRenameResultSchema>;
export type ProjectMarkSetResult = FromSchema<typeof projectMarkSetResultSchema>;
export type ProjectMarkClearResult = FromSchema<typeof projectMarkClearResultSchema>;
export type ProjectMarkReadResult = FromSchema<typeof projectMarkReadResultSchema>;
export type ProjectUnregisterResult = FromSchema<typeof projectUnregisterResultSchema>;
export type ProjectsLocationResult = FromSchema<typeof projectsLocationResultSchema>;
