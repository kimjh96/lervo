import { runVerificationSuite } from "@lervo/verification";

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

/**
 * The one way convergence runs a verification suite: always with the environment above. Every
 * convergence suite runs under the resident's service manager, and a call that forgot the
 * environment failed every canonical integration on `spawnSync pnpm ENOENT` (2026-11-23).
 */
export function runConvergenceVerificationSuite(
  input: Parameters<typeof runVerificationSuite>[0],
  environment: NodeJS.ProcessEnv,
): ReturnType<typeof runVerificationSuite> {
  return runVerificationSuite(input, { environment });
}
