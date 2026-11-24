import {
  defaultProviderCliDetectionPorts,
  detectProviderCliPaths,
} from "./provider-cli-detection.js";

export type ToolEnvironmentDetection = () => ReturnType<typeof detectProviderCliPaths>;

/**
 * The environment the resident runs the owner's tools in, such as `pnpm` for a verification suite
 * or `gh` for knowledge publication. A service manager starts the resident with a minimal PATH that
 * the service definition deliberately keeps free of provider directories (ADR-0536), so tools
 * installed under Homebrew or a version manager are missing there. The tools get the owner's
 * login-shell PATH, the same lookup provider discovery uses; when that lookup fails, the service
 * PATH stands and `detected` is false.
 */
export async function toolEnvironment(
  detect: ToolEnvironmentDetection = () =>
    detectProviderCliPaths(defaultProviderCliDetectionPorts()),
): Promise<{ environment: NodeJS.ProcessEnv; detected: boolean }> {
  const found = await detect().catch(() => null);
  return found === null || found.failure !== null
    ? { environment: process.env, detected: false }
    : { environment: { ...process.env, PATH: found.environment.PATH }, detected: true };
}

/** How long a failed lookup's service PATH is used before the login shell is asked again. */
export const TOOL_ENVIRONMENT_RETRY_MS = 5 * 60_000;

/**
 * The tool environment for a long-lived caller: looked up once and kept after it succeeds. A
 * failed lookup is tried again after a pause, so a login shell that was briefly unavailable does
 * not leave the service PATH in place for the resident's lifetime, and a broken one does not cost
 * every call its lookup timeout.
 */
export function rememberedToolEnvironment(
  detect?: ToolEnvironmentDetection,
  now: () => number = Date.now,
): () => Promise<NodeJS.ProcessEnv> {
  let kept: NodeJS.ProcessEnv | null = null;
  let retryAt = 0;
  return async () => {
    if (kept !== null) return kept;
    if (now() < retryAt) return process.env;
    const { environment, detected } = await toolEnvironment(detect);
    if (detected) kept = environment;
    else retryAt = now() + TOOL_ENVIRONMENT_RETRY_MS;
    return environment;
  };
}
