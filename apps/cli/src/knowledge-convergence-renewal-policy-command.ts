import { parseArgs } from "node:util";

import { listAgents } from "@lervo/agent-workforce";
import {
  continuityPolicyFromDelegation,
  defaultConvergenceContinuityPolicyPath,
  DEFAULT_CONTINUITY_HORIZON_DAYS,
  DEFAULT_CONTINUITY_RENEWAL,
  loadConvergenceDelegation,
  readConvergenceContinuityPolicy,
  sealConvergenceContinuityPolicy,
  writeConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicy,
} from "@lervo/repository-knowledge-runtime";

import type { CliIo } from "./types.js";

const usage =
  "Usage: lervo knowledge convergence delegation renewal-policy <show|install|revoke> [--term-days <1-90>] [--window-hours <1-168>] [--horizon-days <1-366>] [--no-peer-seeding] [--no-template-seeding] [--apply <policy-id>] [--json]";

function bounded(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(usage);
  return parsed;
}

/** Same-day plans and applies share an issue instant, so the reviewed policy ID stays exact. */
function issueDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The policy this repository's reviewed delegation implies: its providers and ceilings become the
 * limits and its scope the template. Installing it is the owner's one-time consent for the host.
 */
async function plannedInstall(
  root: string,
  values: Record<string, string | boolean | undefined>,
): Promise<ConvergenceContinuityPolicy> {
  const loaded = await loadConvergenceDelegation(root);
  if (loaded === null || loaded.delegation.state !== "active")
    throw new Error(
      "Installing a renewal policy derives its scope from this repository's active reviewed delegation; none exists.",
    );
  const parent = (await listAgents(root, { readOnly: true })).find(
    (agent) => agent.agentId === loaded.delegation.parentAgentId,
  );
  if (parent === undefined) throw new Error("The delegation's parent agent does not exist.");
  const termDays = bounded(
    values["term-days"] as string | undefined,
    DEFAULT_CONTINUITY_RENEWAL.termDays,
    1,
    90,
  );
  const windowHours = bounded(
    values["window-hours"] as string | undefined,
    DEFAULT_CONTINUITY_RENEWAL.windowHours,
    1,
    168,
  );
  return continuityPolicyFromDelegation({
    delegation: loaded.delegation,
    parentRoleId: parent.roleId,
    authority: { kind: "owner_installed", reference: null },
    now: issueDay(new Date()),
    renewal: {
      termDays,
      windowHours,
      attentionLeadHours: Math.max(DEFAULT_CONTINUITY_RENEWAL.attentionLeadHours, windowHours),
    },
    horizonDays: bounded(
      values["horizon-days"] as string | undefined,
      DEFAULT_CONTINUITY_HORIZON_DAYS,
      1,
      366,
    ),
    seeding: {
      fromPeer: values["no-peer-seeding"] !== true,
      fromTemplate: values["no-template-seeding"] !== true,
    },
  });
}

function revoked(policy: ConvergenceContinuityPolicy): ConvergenceContinuityPolicy {
  const { policyId: _id, policyHash: _hash, ...body } = policy;
  return sealConvergenceContinuityPolicy({ ...body, state: "revoked" });
}

/**
 * ADR-0469 host continuity policy: `show` prints it, `install` and `revoke` are plan/apply. The
 * plan grants nothing; `--apply` with the exact policy ID writes it under the host's user state
 * directory, fenced against a concurrent change.
 */
export async function runKnowledgeConvergenceRenewalPolicyCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  try {
    const action = args[0];
    const { values } = parseArgs({
      args: [...args.slice(1)],
      strict: true,
      allowPositionals: false,
      options: {
        "term-days": { type: "string" },
        "window-hours": { type: "string" },
        "horizon-days": { type: "string" },
        "no-peer-seeding": { type: "boolean" },
        "no-template-seeding": { type: "boolean" },
        apply: { type: "string" },
        json: { type: "boolean" },
      },
    });
    const indent = values.json ? 2 : undefined;
    const path = defaultConvergenceContinuityPolicyPath();
    if (path === null) throw new Error("The host user state directory cannot be resolved.");
    const current = await readConvergenceContinuityPolicy(path);
    if (action === "show") {
      io.stdout(`${JSON.stringify(current, null, indent)}\n`);
      return 0;
    }
    if (action !== "install" && action !== "revoke") throw new Error(usage);
    if (action === "revoke" && current.status !== "loaded")
      throw new Error("No host continuity policy is installed.");
    const policy =
      action === "install"
        ? await plannedInstall(io.cwd, values)
        : revoked((current as { policy: ConvergenceContinuityPolicy }).policy);
    if (values.apply !== undefined) {
      if (values.apply !== policy.policyId)
        throw new Error("The exact continuity policy changed before application.");
      await writeConvergenceContinuityPolicy({
        path,
        policy,
        expectedPolicyHash: current.status === "loaded" ? current.policy.policyHash : null,
      });
    }
    io.stdout(
      `${JSON.stringify(
        {
          status: values.apply === undefined ? "review_required" : "applied",
          action,
          replaces: current.status === "loaded" ? current.policy.policyId : current.status,
          policy,
        },
        null,
        indent,
      )}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${usage}\n`);
    return 1;
  }
}
