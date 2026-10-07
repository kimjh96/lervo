import { NodeRuntimeError } from "./errors.js";

/** Importability proves installed material only; this never starts a provider or a network request. */
export async function assertNodeRuntimeDependencies(
  load: () => Promise<{ startup?: unknown }> = () => import("@anthropic-ai/claude-agent-sdk"),
): Promise<void> {
  try {
    if (typeof (await load()).startup === "function") return;
  } catch {
    // Keep native import errors and installation paths out of public diagnostics.
  }
  throw new NodeRuntimeError(
    "runtime_dependency_unavailable",
    "The installed Node runtime cannot load its Claude SDK dependency. Reinstall the runtime with its dependency closure.",
  );
}
