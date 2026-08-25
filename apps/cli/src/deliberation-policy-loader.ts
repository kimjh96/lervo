import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { type DeliberationWorkflowSource, validateSchema } from "@lervo/schemas";
import { parse } from "yaml";

const maximumPolicyBytes = 64 * 1024;
const policyIdPattern = /^deliberation_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export class DeliberationPolicySourceError extends Error {
  constructor(
    readonly code:
      | "deliberation_policy_invalid"
      | "deliberation_policy_layout_invalid"
      | "deliberation_policy_not_found",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeliberationPolicySourceError";
  }
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

export function validateDeliberationWorkflowSource(source: DeliberationWorkflowSource): void {
  if (!validateSchema("deliberationWorkflowSource", source).valid) {
    throw new DeliberationPolicySourceError(
      "deliberation_policy_invalid",
      "The deliberation policy file has an unsupported shape.",
    );
  }
  const roleIds = source.participants.map((participant) => participant.roleId);
  const proposers = source.participants.filter((participant) =>
    participant.responsibilities.includes("proposer"),
  );
  const owners = source.participants.filter((participant) =>
    participant.responsibilities.includes("decision_owner"),
  );
  const reviewers = source.participants.filter((participant) =>
    participant.responsibilities.includes("reviewer"),
  );
  const verifiers = source.participants.filter((participant) =>
    participant.responsibilities.includes("verifier"),
  );
  const proposer = proposers[0];
  const verifier = verifiers[0];
  if (
    new Set(roleIds).size !== roleIds.length ||
    source.participants.some(
      (participant) => participant.provider !== "codex" && participant.provider !== "claude",
    ) ||
    new Set(source.participants.map((participant) => participant.provider)).size < 2 ||
    proposers.length !== 1 ||
    owners.length !== 1 ||
    proposer?.roleId !== owners[0]?.roleId ||
    proposer === undefined ||
    !sameSet(proposer.responsibilities, ["proposer", "decision_owner"]) ||
    reviewers.length === 0 ||
    reviewers.some((participant) => !sameSet(participant.responsibilities, ["reviewer"])) ||
    verifiers.length !== 1 ||
    verifier === undefined ||
    !sameSet(verifier.responsibilities, ["verifier"]) ||
    reviewers.some((participant) => participant.roleId === verifier.roleId)
  ) {
    throw new DeliberationPolicySourceError(
      "deliberation_policy_invalid",
      "The deliberation policy must define a distinct proposal and decision role, at least one review role, and a separate verification role.",
    );
  }
}

export async function loadDeliberationWorkflowSource(
  repositoryRoot: string,
  policyId: string,
): Promise<DeliberationWorkflowSource> {
  if (!policyIdPattern.test(policyId) || policyId.length > 150) {
    throw new DeliberationPolicySourceError(
      "deliberation_policy_invalid",
      "The deliberation policy ID is invalid.",
    );
  }
  const root = resolve(repositoryRoot);
  const directory = resolve(root, ".lervo/deliberations");
  try {
    const stats = await lstat(directory);
    const expected = resolve(await realpath(root), ".lervo/deliberations");
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (await realpath(directory)) !== expected
    ) {
      throw new Error("unsafe directory");
    }
  } catch (error) {
    throw new DeliberationPolicySourceError(
      "deliberation_policy_layout_invalid",
      "The deliberation policy directory is not a safe physical directory.",
      { cause: error },
    );
  }

  const path = resolve(directory, `${policyId}.yaml`);
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumPolicyBytes) {
      throw new DeliberationPolicySourceError(
        "deliberation_policy_layout_invalid",
        "The deliberation policy is not a safe regular file or exceeds the size limit.",
      );
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new DeliberationPolicySourceError(
        "deliberation_policy_layout_invalid",
        "The deliberation policy changed while it was being read.",
      );
    }
    let value: unknown;
    try {
      value = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      throw new DeliberationPolicySourceError(
        "deliberation_policy_invalid",
        "The deliberation policy YAML could not be read.",
        { cause: error },
      );
    }
    const source = value as DeliberationWorkflowSource;
    validateDeliberationWorkflowSource(source);
    if (source.policyId !== policyId) {
      throw new DeliberationPolicySourceError(
        "deliberation_policy_invalid",
        "The deliberation policy filename does not match its policy ID.",
      );
    }
    return structuredClone(source);
  } catch (error) {
    if (error instanceof DeliberationPolicySourceError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DeliberationPolicySourceError(
        "deliberation_policy_not_found",
        "The requested deliberation policy was not found.",
      );
    }
    throw new DeliberationPolicySourceError(
      "deliberation_policy_layout_invalid",
      "The deliberation policy could not be read safely.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}
