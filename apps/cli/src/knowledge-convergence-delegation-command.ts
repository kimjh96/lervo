import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openProjectStorage, openReadOnlyProjectStorage } from "@lervo/project-storage";
import {
  createConvergenceDelegationPlan,
  applyConvergenceDelegationPlan,
} from "@lervo/repository-knowledge-runtime";
import { runKnowledgeConvergenceRenewalPolicyCommand } from "./knowledge-convergence-renewal-policy-command.js";
import { runKnowledgeConvergenceSeedCommand } from "./knowledge-convergence-seed-command.js";
import { REMOVED_SCOPE_RESPONSE } from "./removed-approval-options.js";
import type { CliIo } from "./types.js";

const usage =
  "Usage: lervo knowledge convergence delegation --from <reviewed-delegation.json> [--asset-manifest-from <reviewed-assets.json>] [--apply <plan-id>] [--json]\n       lervo knowledge convergence delegation renewal-policy <show|install|revoke> ...\n       lervo knowledge convergence delegation seed [--json]";

export async function runKnowledgeConvergenceDelegationCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  if (args[0] === "scope-response") {
    io.stderr(`${REMOVED_SCOPE_RESPONSE}\n`);
    return 1;
  }
  if (args[0] === "renewal-policy")
    return runKnowledgeConvergenceRenewalPolicyCommand(args.slice(1), io);
  if (args[0] === "seed") return runKnowledgeConvergenceSeedCommand(args.slice(1), io);
  try {
    const { values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        from: { type: "string" },
        "asset-manifest-from": { type: "string" },
        apply: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (!values.from) throw new Error(usage);
    const file = await readFile(resolve(io.cwd, values.from));
    if (file.byteLength > 64 * 1024)
      throw new Error("The reviewed delegation exceeds its byte limit.");
    const value: unknown = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file));
    const reviewedManifestBytes = values["asset-manifest-from"]
      ? await readFile(resolve(io.cwd, values["asset-manifest-from"]))
      : undefined;
    if (reviewedManifestBytes !== undefined && reviewedManifestBytes.byteLength > 1024 * 1024)
      throw new Error("The reviewed asset manifest exceeds its byte limit.");
    const storage = await (values.apply ? openProjectStorage : openReadOnlyProjectStorage)(io.cwd);
    try {
      const plan = await createConvergenceDelegationPlan(storage, value, {
        ...(reviewedManifestBytes === undefined ? {} : { reviewedManifestBytes }),
      });
      if (values.apply !== undefined) {
        if (values.apply !== plan.planId)
          throw new Error("The exact delegation plan changed before application.");
        await applyConvergenceDelegationPlan(storage, plan);
      }
      io.stdout(
        `${JSON.stringify({ status: values.apply ? "applied" : "review_required", ...plan }, null, values.json ? 2 : undefined)}\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${usage}\n`);
    return 1;
  }
}
