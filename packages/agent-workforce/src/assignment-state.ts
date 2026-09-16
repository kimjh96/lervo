import { ASSIGNMENT_ID, fail, validAssignment } from "./workforce-state-validation.js";
import { state, readBounded } from "./workforce-state-io.js";
import { resolve } from "node:path";
import { type WorkforceAssignment } from "./types.js";
import { resolveRoleContract } from "@lervo/roles";
import { readdir } from "node:fs/promises";
import { workforceLimits } from "./limits.js";

export async function assignmentPath(
  root: string,
  assignmentId: string,
): Promise<{ path: string; lockPath: string; projectId: string }> {
  if (!ASSIGNMENT_ID.test(assignmentId))
    fail("assignment_invalid", "The assignment ID is invalid.");
  const current = await state(root);
  return {
    path: resolve(current.base, "assignments", `${assignmentId}.json`),
    lockPath: resolve(current.base, "scheduler.lock"),
    projectId: current.manifest.projectId,
  };
}

export async function readAssignmentState(
  root: string,
  assignmentId: string,
): Promise<{ value: WorkforceAssignment; source: string }> {
  const target = await assignmentPath(root, assignmentId);
  return readAssignmentAt(root, assignmentId, target);
}

async function readAssignmentAt(
  root: string,
  assignmentId: string,
  target: { path: string; projectId: string },
): Promise<{ value: WorkforceAssignment; source: string }> {
  const source = await readBounded(target.path);
  if (source === null) fail("assignment_not_found", "The assignment does not exist.");
  const value = JSON.parse(source) as WorkforceAssignment;
  if (!validAssignment(value, target.projectId) || value.assignmentId !== assignmentId)
    fail("workforce_state_invalid", "The assignment state is invalid.");
  const contract = await resolveRoleContract(root, value.roleId);
  if (value.roleVersion === undefined || value.roleContractHash === undefined) {
    if (contract.sourceKind !== "built_in")
      fail("workforce_state_invalid", "A legacy assignment cannot bind to a repository role.");
    return {
      source,
      value: { ...value, roleVersion: contract.version, roleContractHash: contract.contractHash },
    };
  }
  if (value.roleVersion !== contract.version || value.roleContractHash !== contract.contractHash)
    fail(
      "assignment_lease_conflict",
      `Assignment ${assignmentId} is bound to a stale role contract.`,
    );
  return { source, value };
}

export interface RawAssignmentState {
  path: string;
  lockPath: string;
  source: string;
  value: WorkforceAssignment;
  projectId: string;
}

export async function listRawAssignmentStates(root: string): Promise<RawAssignmentState[]> {
  const current = await state(root, { readOnly: true });
  const directory = resolve(current.base, "assignments");
  let names: string[];
  try {
    names = (await readdir(directory))
      .filter((name) => /^asn_[a-f0-9]{24}\.json$/u.test(name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (names.length > workforceLimits.maximumAssignments)
    fail("workforce_state_invalid", "The assignment limit was exceeded.");
  return Promise.all(
    names.map(async (name) => {
      const path = resolve(directory, name);
      const source = await readBounded(path);
      const value = JSON.parse(source ?? "null") as WorkforceAssignment;
      const assignmentId = name.slice(0, -5);
      if (
        !validAssignment(value, current.manifest.projectId) ||
        value.assignmentId !== assignmentId
      )
        fail("workforce_state_invalid", "The assignment state is invalid.");
      return {
        path,
        lockPath: resolve(current.base, "scheduler.lock"),
        source: source!,
        value,
        projectId: current.manifest.projectId,
      };
    }),
  );
}

export async function readAssignment(
  root: string,
  assignmentId: string,
): Promise<WorkforceAssignment> {
  return (await readAssignmentState(root, assignmentId)).value;
}

export async function listAssignments(root: string): Promise<WorkforceAssignment[]> {
  const current = await state(root);
  const names = (await readdir(resolve(current.base, "assignments")))
    .filter((name) => /^asn_[a-f0-9]{24}\.json$/u.test(name))
    .sort();
  if (names.length > workforceLimits.maximumAssignments)
    fail("workforce_state_invalid", "The assignment limit was exceeded.");
  return Promise.all(
    names.map(
      async (name) =>
        (
          await readAssignmentAt(root, name.slice(0, -5), {
            path: resolve(current.base, "assignments", name),
            projectId: current.manifest.projectId,
          })
        ).value,
    ),
  );
}
