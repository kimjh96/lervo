import {
  inspectProviderExecutable,
  type ProviderRuntimeInspection,
} from "@lervo/adapter-contract";

export async function inspectCodexRuntime(
  executable = "codex",
): Promise<ProviderRuntimeInspection> {
  return inspectProviderExecutable({
    provider: "codex",
    executable,
    source: executable === "codex" ? "path" : "configured",
  });
}
