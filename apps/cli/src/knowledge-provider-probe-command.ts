import { parseArgs } from "node:util";
import { openProjectStorage } from "@lervo/project-storage";
import { probeKnowledgeProviderAvailability } from "@lervo/repository-knowledge-runtime";
import { hostRepositoryRoots } from "./knowledge-host-repositories.js";
import type { CliIo } from "./types.js";

export async function runKnowledgeProviderProbeCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  try {
    const { values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: { provider: { type: "string" }, json: { type: "boolean" } },
    });
    if (values.provider !== "codex" && values.provider !== "claude")
      throw new Error("Select codex or claude for the explicit native probe.");
    const storage = await openProjectStorage(io.cwd);
    try {
      const result = await probeKnowledgeProviderAvailability({
        storage,
        provider: values.provider,
        // A resumed provider clears its recorded failures in every repository on this host.
        hostRepositoryRoots: await hostRepositoryRoots(),
      });
      io.stdout(`${JSON.stringify(result, null, values.json ? 2 : undefined)}\n`);
      return result.resumed ? 0 : 1;
    } finally {
      await storage.close();
    }
  } catch (error) {
    io.stderr(`${(error as { code?: string }).code ?? "knowledge_provider_probe_failed"}\n`);
    return 1;
  }
}
