import { materializationEventRecorded } from "./knowledge-materialization-history.js";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { recoverKnowledgeMaterialization } from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import type { CliIo } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";

/** `lervo knowledge materialize --recover`: settles an interrupted knowledge materialization. */
export async function runKnowledgeMaterializationRecovery(
  args: string[],
  io: CliIo,
): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        recover: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (!parsed.values.recover) throw new Error("materialize requires --recover.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const storage = await openProjectStorage(root);
    try {
      const recovered = await recoverKnowledgeMaterialization({
        repositoryRoot: root,
        eventRecorded: (planId) => materializationEventRecorded(storage.events, planId),
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(recovered, null, 2)}\n`
          : `Knowledge materialization transaction recovered: ${recovered.disposition === "rolled_back" ? "changes before the event were rolled back" : "recorded event outputs were retained and markers removed"}\nplan: ${recovered.planId}\n`,
      );
    } finally {
      await storage.close();
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
