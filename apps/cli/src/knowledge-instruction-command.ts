import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { CliIo, CliServices } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import { runKnowledgeDurableInstruction } from "./knowledge-durable-instruction-command.js";
import { runKnowledgeInstructionCapture } from "./knowledge-instruction-capture-command.js";
import { runInstructionBridge } from "./instruction-bridge-command.js";
import { crossCheckPlan } from "./plan-cross-check.js";
import { REMOVED_APPROVE_ITEM } from "./removed-approval-options.js";

export async function runKnowledgeInstruction(
  args: string[],
  io: CliIo,
  services?: Partial<
    Pick<CliServices, "groundProductionRequest" | "crossCheckDurableInstruction" | "crossCheckPlan">
  >,
): Promise<number> {
  try {
    if (["intake", "status", "retire"].includes(args[0] ?? ""))
      return await runKnowledgeDurableInstruction(
        args,
        io,
        services?.groundProductionRequest === undefined ||
          services.crossCheckDurableInstruction === undefined
          ? undefined
          : {
              groundProductionRequest: services.groundProductionRequest,
              crossCheckDurableInstruction: services.crossCheckDurableInstruction,
            },
      );
    if (args[0] === "capture") return await runKnowledgeInstructionCapture(args.slice(1), io);
    if (args[0] !== "bridge")
      throw new Error(
        "The instruction command supports intake, status, retire, capture, and bridge.",
      );
    if (args.includes("--approve-item")) throw new Error(REMOVED_APPROVE_ITEM);
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        "cross-check-provider": { type: "string" },
        apply: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== "claude")
      throw new Error("The first instruction bridge profile requires --provider claude.");
    const crossCheckProvider = parsed.values["cross-check-provider"];
    if (
      crossCheckProvider !== undefined &&
      crossCheckProvider !== "codex" &&
      crossCheckProvider !== "claude"
    )
      throw new Error("--cross-check-provider must be codex or claude.");
    return await runInstructionBridge({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      ...(parsed.values.apply === undefined ? {} : { applyPlanId: parsed.values.apply }),
      ...(crossCheckProvider === undefined ? {} : { provider: crossCheckProvider }),
      json: parsed.values.json === true,
      io,
      crossCheckPlan: services?.crossCheckPlan ?? crossCheckPlan,
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
