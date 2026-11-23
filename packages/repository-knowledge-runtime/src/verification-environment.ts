import {
  defaultProviderCliDetectionPorts,
  detectProviderCliPaths,
} from "./provider-cli-detection.js";

/**
 * The environment verification commands run in. A service manager starts the resident with a
 * minimal PATH that the service definition deliberately keeps free of provider directories
 * (ADR-0536), so a suite's own tools, such as `pnpm` for the isolated workspace, were missing and
 * every canonical integration failed. The commands get the owner's login-shell PATH, the same
 * lookup provider discovery uses; when that lookup fails, the service PATH stands.
 */
export async function verificationEnvironment(
  detect: () => ReturnType<typeof detectProviderCliPaths> = () =>
    detectProviderCliPaths(defaultProviderCliDetectionPorts()),
): Promise<NodeJS.ProcessEnv> {
  const detected = await detect().catch(() => null);
  return detected === null || detected.failure !== null
    ? process.env
    : { ...process.env, PATH: detected.environment.PATH };
}
