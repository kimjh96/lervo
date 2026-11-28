// Adding, editing, and removing a project's own roles (ADR-0662), as `lervo role add|edit|remove`
// and the core link's `role.*` commands do. The roles package decides what a source says; this
// module sequences authority, validation, the write, the agents' bindings, and the notice.
import {
  applyWorkforceRoleBindingMigration,
  createWorkforceRoleBindingMigrationPlan,
  readRoleHolders,
} from "@lervo/agent-workforce";
import {
  assertRoleNameAvailable,
  derivedRoleId,
  editedRoleSource,
  ensureTemplateRole,
  listRoleContracts,
  listRoleTemplates,
  ORGANIZATION_REQUEST_TYPE,
  parseRepositoryRoleSource,
  previewRoleContracts,
  projectRolePath,
  projectRoleSource,
  readOwnRoleSource,
  removeRoleSource,
  restoreRoleSource,
  RoleContractError,
  roleDependents,
  writeRoleSource,
  type ProjectRoleDraft,
  type ProjectRoleEdit,
  type RepositoryRoleSource,
  type ResolvedRoleContract,
} from "@lervo/roles";

import { CommandFailure } from "./command-error-output.js";
import { assertOrganizationAuthority } from "./organization-authority.js";
import {
  keepRemovedRoleSource,
  noticeRoleAdded,
  noticeRoleEdited,
  noticeRoleRemoved,
  noticeTemplateWritten,
} from "./project-role-notices.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

/** A new project role: from a template with its words, or a complete source (ADR-0209). */
export type ProjectRoleAddition =
  | (Omit<ProjectRoleDraft, "roleId" | "template"> & { roleId?: string; from: string })
  | { source: unknown };

/** Every role a project can name: its contracts and the templates it has not written yet. */
async function catalog(root: string) {
  const contracts = await listRoleContracts(root);
  const names = [
    ...contracts.map((contract) => ({
      roleId: contract.roleId,
      name: contract.definition.profile.name,
    })),
    ...listRoleTemplates().filter(
      (template) => !contracts.some((contract) => contract.roleId === template.roleId),
    ),
  ];
  return { contracts, names };
}

function contractOf(contracts: readonly ResolvedRoleContract[], roleId: string) {
  const contract = contracts.find((candidate) => candidate.roleId === roleId);
  if (contract === undefined)
    throw new RoleContractError("role_not_found", `Role ${roleId} does not resolve.`);
  return contract;
}

/** The source a new role starts as, with its template written first when it is one. */
async function additionSource(root: string, addition: ProjectRoleAddition) {
  if ("source" in addition) return parseRepositoryRoleSource(addition.source);
  // A template role, such as the product owner, is written as a hire would write it.
  if ((await ensureTemplateRole(root, addition.from)) === "written")
    await noticeTemplateWritten(root, addition.from);
  const { contracts, names } = await catalog(root);
  const template = contractOf(contracts, addition.from);
  const roleId =
    addition.roleId ?? derivedRoleId(addition.name, new Set(names.map((role) => role.roleId)));
  return projectRoleSource({ ...addition, roleId, template });
}

/**
 * Adds a project role and returns its resolved contract. A role whose ID is taken fails with
 * `role_exists`, a name another role has with `role_name_conflict`, and an agent whose role lacks
 * `organization.coordinate` with `agent_not_authorized`.
 */
export async function addProjectRole(
  root: string,
  addition: ProjectRoleAddition,
  actorAgentId: string | undefined,
): Promise<ResolvedRoleContract> {
  await assertOrganizationAuthority(root, actorAgentId, ORGANIZATION_REQUEST_TYPE);
  const source = await additionSource(root, addition);
  const { names } = await catalog(root);
  if (names.some((role) => role.roleId === source.roleId))
    throw new RoleContractError("role_exists", `Role ${source.roleId} already exists.`);
  assertRoleNameAvailable(names, source.profile.name ?? "", source.roleId);
  const contract = contractOf(await previewRoleContracts(root, [source]), source.roleId);
  await writeRoleSource(root, source, "create");
  await noticeRoleAdded(root, source.roleId, source.version);
  return contract;
}

/** The checkout's own source of a project role; a built-in role is Lervo's and stays as it is. */
async function ownSource(root: string, roleId: string, contracts: ResolvedRoleContract[]) {
  if (
    contracts.some((contract) => contract.roleId === roleId && contract.sourceKind === "built_in")
  )
    throw new RoleContractError(
      "role_built_in",
      `${roleId} is one of Lervo's templates; add a project role from it instead.`,
    );
  const own = await readOwnRoleSource(root, roleId);
  if (own === null)
    throw new RoleContractError(
      "role_not_found",
      `${projectRolePath(roleId)} is not in this checkout.`,
    );
  const dependents = roleDependents(contracts, roleId);
  if (dependents.length > 0)
    throw new RoleContractError(
      "role_extended",
      `Role ${roleId} is extended by ${dependents.join(", ")}; change or remove those first.`,
    );
  return own;
}

/**
 * Moves every agent and assignment bound to the edited role to its new version, as ADR-0561's
 * refresh does. A plan with ambiguous capability targets restores the previous source and fails
 * with `role_binding_blocked`; a refresh that stops partway resumes on the next `lervo upgrade`.
 */
async function refreshBindings(root: string, roleId: string, previousBytes: string) {
  const plan = await createWorkforceRoleBindingMigrationPlan(root);
  if (plan.status === "blocked") {
    await restoreRoleSource(root, roleId, previousBytes);
    throw new CommandFailure(
      "role_binding_blocked",
      `The agents bound to ${roleId} cannot move to its new version (${plan.reason}).`,
    );
  }
  if (plan.status === "ready")
    await mutateWorkforceState(root, (recordEvent) =>
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        planId: plan.planId,
        recordEvent,
      }),
    );
}

/**
 * Edits a project role's name, description, or added request types at its next version, and moves
 * the agents bound to it there. An edit that changes nothing writes nothing.
 */
export async function editProjectRole(
  root: string,
  roleId: string,
  edit: ProjectRoleEdit,
  actorAgentId: string | undefined,
): Promise<{ contract: ResolvedRoleContract; changed: boolean }> {
  await assertOrganizationAuthority(root, actorAgentId, ORGANIZATION_REQUEST_TYPE);
  // The hire menu offers a template role before the project writes it; editing writes it first.
  if ((await ensureTemplateRole(root, roleId)) === "written")
    await noticeTemplateWritten(root, roleId);
  const { contracts, names } = await catalog(root);
  const before = contractOf(contracts, roleId);
  const own = await ownSource(root, roleId, contracts);
  const next = editedRoleSource(own.source, edit);
  if (next === null) return { contract: before, changed: false };
  if (edit.name !== undefined) assertRoleNameAvailable(names, edit.name, roleId);
  const after = contractOf(await previewRoleContracts(root, [next]), roleId);
  const holders = await readRoleHolders(root, roleId);
  await writeRoleSource(root, next, "replace");
  await refreshBindings(root, roleId, own.bytes);
  const previousTypes = new Set(before.definition.profile.requestTypes);
  await noticeRoleEdited(root, {
    roleId,
    version: next.version,
    previous: previousWords(own.source, edit),
    widened: after.definition.profile.requestTypes.filter((type) => !previousTypes.has(type)),
    movedAgentIds: holders.agentIds,
  });
  return { contract: after, changed: true };
}

/** What an edit replaced, so its undo puts exactly that back. */
function previousWords(source: RepositoryRoleSource, edit: ProjectRoleEdit) {
  return {
    ...(edit.name === undefined ? {} : { name: source.profile.name ?? "" }),
    ...(edit.description === undefined ? {} : { description: source.profile.description ?? "" }),
    requestTypes: source.profile.requestTypes ?? [],
  };
}

/**
 * Removes a project role that nothing holds. An agent that is not retired or an assignment that
 * has not ended fails it with `role_in_use`: move them to another role, or retire or finish them,
 * first. Retired agents and ended assignments keep their exact binding as history (ADR-0209).
 */
export async function removeProjectRole(
  root: string,
  roleId: string,
  actorAgentId: string | undefined,
): Promise<{ roleId: string; version: string }> {
  await assertOrganizationAuthority(root, actorAgentId, ORGANIZATION_REQUEST_TYPE);
  const contracts = await listRoleContracts(root);
  const own = await ownSource(root, roleId, contracts);
  const holders = await readRoleHolders(root, roleId);
  if (holders.agentIds.length + holders.assignmentIds.length > 0)
    throw new CommandFailure(
      "role_in_use",
      `Role ${roleId} is held by ${holders.agentIds.length} agent(s) and ${holders.assignmentIds.length} open assignment(s); move or retire them first.`,
      { agentIds: holders.agentIds, assignmentIds: holders.assignmentIds },
    );
  const keptPath = await keepRemovedRoleSource(root, roleId, own.bytes);
  await removeRoleSource(root, roleId);
  await noticeRoleRemoved(root, { roleId, version: own.source.version, keptPath });
  return { roleId, version: own.source.version };
}
