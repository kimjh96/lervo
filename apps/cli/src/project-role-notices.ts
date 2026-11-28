// The after-the-fact notices of project role changes and the kept source that makes a removal
// undoable (ADR-0662, invariant 10).
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";
import { projectRolePath } from "@lervo/roles";

import { noticeEffect } from "./effect-notice.js";

/** How many removed roles' sources the project keeps for undo; the oldest go first. */
const KEPT_REMOVED_ROLES = 32;

/** A value as one single-quoted shell word, so an undo command never splits a path or a name. */
export function shellWord(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function removedRolesDirectory(root: string): string {
  return resolve(resolveProjectPaths(root).data, "removed-roles");
}

/**
 * Keeps a removed role's exact source bytes in the project's local data, one file per role ID,
 * and prunes the directory to the newest `KEPT_REMOVED_ROLES`. Returns the kept file's path.
 */
export async function keepRemovedRoleSource(
  root: string,
  roleId: string,
  bytes: string,
): Promise<string> {
  const directory = removedRolesDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${roleId}.json`);
  await writeFile(path, bytes, { mode: 0o600 });
  const kept = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => ({ name, at: (await lstat(resolve(directory, name))).mtimeMs })),
  );
  const oldest = kept.toSorted((left, right) => right.at - left.at).slice(KEPT_REMOVED_ROLES);
  await Promise.all(oldest.map(({ name }) => rm(resolve(directory, name), { force: true })));
  return path;
}

/** The roles a notice names: the role's source and the agents its change moved. */
function targets(roleId: string, agentIds: readonly string[]): string[] {
  return [projectRolePath(roleId), ...agentIds];
}

/** A template role, such as the product owner, written so a new role can start from it. */
export async function noticeTemplateWritten(root: string, roleId: string) {
  await noticeEffect({
    repositoryRoot: root,
    effect: "role_template_written",
    subject: `${roleId}:template`,
    targets: targets(roleId, []),
    reason: "template_role_extended_by_a_new_role",
    reviewers: ["role_contract_resolved"],
    verdict: "verified",
    undo: `lervo role remove --role ${roleId} --write`,
  });
}

export async function noticeRoleAdded(root: string, roleId: string, version: string) {
  await noticeEffect({
    repositoryRoot: root,
    effect: "role_added",
    subject: `${roleId}@${version}`,
    targets: targets(roleId, []),
    reason: "project_role_added",
    reviewers: ["role_contract_resolved"],
    verdict: "verified",
    undo: `lervo role remove --role ${roleId} --write`,
  });
}

/**
 * An edit's notice. Widened request types are named in the reason, with the agents bound to the
 * role, as ADR-0639 requires of a widening; the undo puts the previous words and types back.
 */
export async function noticeRoleEdited(
  root: string,
  edit: {
    roleId: string;
    version: string;
    previous: { name?: string; description?: string; requestTypes?: readonly string[] };
    widened: readonly string[];
    movedAgentIds: readonly string[];
  },
) {
  const { previous } = edit;
  const undo = [
    `lervo role edit --role ${edit.roleId}`,
    previous.name === undefined ? "" : ` --name ${shellWord(previous.name)}`,
    previous.description === undefined ? "" : ` --description ${shellWord(previous.description)}`,
    ` --request-types ${shellWord((previous.requestTypes ?? []).join(","))}`,
    " --write",
  ].join("");
  await noticeEffect({
    repositoryRoot: root,
    effect: "role_edited",
    subject: `${edit.roleId}@${edit.version}`,
    targets: targets(edit.roleId, edit.movedAgentIds),
    reason:
      edit.widened.length === 0
        ? "project_role_edited"
        : `project_role_edited; request types widened: ${edit.widened.join(", ")}`,
    reviewers: ["role_contract_resolved", "role_bindings_refreshed"],
    verdict: "verified",
    undo,
  });
}

export async function noticeRoleRemoved(
  root: string,
  removal: { roleId: string; version: string; keptPath: string },
) {
  await noticeEffect({
    repositoryRoot: root,
    effect: "role_removed",
    subject: `${removal.roleId}@${removal.version}`,
    targets: targets(removal.roleId, []),
    reason: "project_role_removed_without_holders",
    reviewers: ["role_holders_absent", "role_dependents_absent"],
    verdict: "verified",
    undo: `lervo role add --source ${shellWord(removal.keptPath)} --write`,
  });
}
