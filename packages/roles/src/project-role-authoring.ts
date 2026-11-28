// The pure decisions of authoring a project role (ADR-0662): the source a new role starts as, the
// next version an edit writes, the ID a role's name derives, and what an organization request
// type grants. Reading and writing the source files is `project-role-store.ts`'s.
import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { RoleProfile } from "@lervo/schemas";

import {
  parseRepositoryRoleSource,
  ROLE_ID,
  type RepositoryRoleSource,
} from "./repository-role-source.js";
import type { ResolvedRoleContract } from "./types.js";
import { RoleContractError } from "./types.js";

/**
 * The request type that lets an agent's role add, edit, and remove project roles and move agents
 * between roles (ADR-0662). The owner needs none.
 */
export const ORGANIZATION_REQUEST_TYPE = "organization.coordinate";
/** The request type that lets an agent's role hire (ADR-0662). The owner needs none. */
export const HIRING_REQUEST_TYPE = "agent.hire";

export const MAXIMUM_ROLE_NAME_LENGTH = 100;
export const MAXIMUM_ROLE_DESCRIPTION_LENGTH = 1000;
const MAXIMUM_REQUEST_TYPES = 32;
/** Short enough that a derived ID fits the core link's 64-character role ID with a suffix. */
const MAXIMUM_DERIVED_ID_LENGTH = 48;
const REQUEST_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

/** Whether a role's request types carry `requestType`, the authority ADR-0639 names them. */
export function grantsRequestType(contract: ResolvedRoleContract, requestType: string): boolean {
  return contract.definition.profile.requestTypes.includes(requestType);
}

function invalid(message: string): never {
  throw new RoleContractError("role_profile_invalid", message);
}

/** One line of a role's prose: trimmed, not empty, without control characters, and bounded. */
function prose(value: string, maximum: number, what: string): string {
  const text = value.trim();
  if (text.length === 0 || [...text].length > maximum || /[\p{Cc}\p{Cf}]/u.test(text))
    invalid(`The role ${what} must be 1 to ${maximum} characters without control characters.`);
  return text;
}

function requestTypes(values: readonly string[]): string[] {
  const types = [...new Set(values)].sort();
  if (
    types.length > MAXIMUM_REQUEST_TYPES ||
    !types.every((type) => type.length <= 64 && REQUEST_TYPE.test(type))
  )
    invalid("The role request types are invalid.");
  return types;
}

/**
 * The role ID a role's name derives: its ASCII words joined by hyphens, such as `drawing-review`
 * for "Drawing Review". A name without them, such as one in Korean, derives `role-<hash>`. A taken
 * ID gains `-2`, `-3`, and so on.
 */
export function derivedRoleId(name: string, taken: ReadonlySet<string>): string {
  const words = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^[^a-z]+/u, "")
    .slice(0, MAXIMUM_DERIVED_ID_LENGTH)
    .replace(/-+$/u, "");
  const stem = ROLE_ID.test(words)
    ? words
    : `role-${createHash("sha256").update(name.trim()).digest("hex").slice(0, 8)}`;
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix += 1)
    if (!taken.has(`${stem}-${suffix}`)) return `${stem}-${suffix}`;
}

/** What a new project role is: its ID, name, description, and the template it starts from. */
export interface ProjectRoleDraft {
  roleId: string;
  name: string;
  description: string;
  /** The built-in or project role it extends at its exact current version. */
  template: Pick<ResolvedRoleContract, "roleId" | "version">;
  /** Request types it adds to its template's; capabilities only narrow the template's. */
  requestTypes?: readonly string[];
  capabilities?: Partial<RoleProfile["capabilities"]>;
}

/**
 * The source a new project role starts as, at version 1.0.0, extending its template (ADR-0639: a
 * role is never designed from nothing by a command). It is checked as any role source is.
 */
export function projectRoleSource(draft: ProjectRoleDraft): RepositoryRoleSource {
  const types = requestTypes(draft.requestTypes ?? []);
  return parseRepositoryRoleSource(
    {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: draft.roleId,
      version: "1.0.0",
      extends: [{ roleId: draft.template.roleId, version: draft.template.version }],
      profile: {
        name: prose(draft.name, MAXIMUM_ROLE_NAME_LENGTH, "name"),
        description: prose(draft.description, MAXIMUM_ROLE_DESCRIPTION_LENGTH, "description"),
        ...(types.length === 0 ? {} : { requestTypes: types }),
        ...(draft.capabilities === undefined ? {} : { capabilities: draft.capabilities }),
      },
      checks: [],
    },
    draft.roleId,
  );
}

/** What an edit changes: the role's name, its description, or the request types it adds. */
export interface ProjectRoleEdit {
  name?: string;
  description?: string;
  /** The request types the role adds to its template's, replacing those it added before. */
  requestTypes?: readonly string[];
}

/** The version an edit writes: the next minor version, as an edit keeps the role's identity. */
export function nextRoleVersion(version: string): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\./u.exec(version);
  if (match === null) invalid("The role version is invalid.");
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

/**
 * The source after an edit, at the next version, or null when the edit changes nothing, so an
 * unchanged role keeps its version and its agents' bindings.
 */
export function editedRoleSource(
  source: RepositoryRoleSource,
  edit: ProjectRoleEdit,
): RepositoryRoleSource | null {
  const profile = { ...source.profile };
  if (edit.name !== undefined) profile.name = prose(edit.name, MAXIMUM_ROLE_NAME_LENGTH, "name");
  if (edit.description !== undefined)
    profile.description = prose(edit.description, MAXIMUM_ROLE_DESCRIPTION_LENGTH, "description");
  if (edit.requestTypes !== undefined) {
    const types = requestTypes(edit.requestTypes);
    if (types.length === 0) delete profile.requestTypes;
    else profile.requestTypes = types;
  }
  if (canonicalJson(profile) === canonicalJson(source.profile)) return null;
  return parseRepositoryRoleSource(
    { ...source, version: nextRoleVersion(source.version), profile },
    source.roleId,
  );
}

/** The roles that extend `roleId`, whose exact ancestry pins an edit or removal would break. */
export function roleDependents(
  contracts: readonly ResolvedRoleContract[],
  roleId: string,
): string[] {
  return contracts
    .filter((contract) => contract.extends.some((base) => base.roleId === roleId))
    .map((contract) => contract.roleId)
    .sort();
}

/**
 * Refuses a name another role already has, compared ignoring case, so the hire menu never offers
 * two roles that read the same.
 */
export function assertRoleNameAvailable(
  roles: readonly { roleId: string; name: string }[],
  name: string,
  roleId: string,
): void {
  const taken = roles.find(
    (role) =>
      role.roleId !== roleId &&
      role.name.localeCompare(name.trim(), undefined, { sensitivity: "accent" }) === 0,
  );
  if (taken !== undefined)
    throw new RoleContractError(
      "role_name_conflict",
      `Role ${taken.roleId} is already named ${taken.name}.`,
    );
}
