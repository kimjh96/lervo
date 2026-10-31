import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openProjectStorage } from "@lervo/project-storage";
import {
  createConvergenceDelegationPlan,
  recordDocumentRouteScopeDecision,
} from "@lervo/repository-knowledge-runtime";
import type { CliIo } from "./types.js";

/** The owner response is recorded through the delegation's existing decision receipt path. */
export async function runKnowledgeDocumentScopeResponseCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args: [...args],
      strict: true,
      options: {
        proposal: { type: "string" },
        response: { type: "string" },
        "evidence-hash": { type: "string" },
        from: { type: "string" },
        apply: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (
      !values.proposal ||
      !values["evidence-hash"] ||
      (values.response !== "accept" && values.response !== "decline") ||
      (values.response === "decline" &&
        (values.from !== undefined || values.apply !== undefined)) ||
      (values.response === "accept" && (!values.from || !values.apply))
    )
      throw new Error(
        "Use scope-response --proposal <id> --response <accept|decline> --evidence-hash <owner-turn-artifact-hash>. Acceptance also requires --from <reviewed-delegation.json> --apply <plan-id>.",
      );
    const storage = await openProjectStorage(io.cwd);
    try {
      const bytes = values.from === undefined ? null : await readFile(resolve(io.cwd, values.from));
      if (bytes !== null && bytes.byteLength > 64 * 1024)
        throw new Error("The reviewed delegation exceeds its byte limit.");
      const plan =
        bytes === null
          ? undefined
          : await createConvergenceDelegationPlan(
              storage,
              JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
            );
      if (plan !== undefined && values.apply !== plan.planId)
        throw new Error("The exact delegation plan changed before application.");
      const proposal = await recordDocumentRouteScopeDecision({
        storage,
        proposalId: values.proposal,
        response: values.response,
        evidenceArtifactHash: values["evidence-hash"],
        ...(plan === undefined ? {} : { delegationPlan: plan }),
      });
      io.stdout(
        `${JSON.stringify({ proposalId: proposal.proposalId, response: values.response }, null, values.json ? 2 : undefined)}\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
