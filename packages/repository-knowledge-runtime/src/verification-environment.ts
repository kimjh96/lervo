import { runVerificationSuite } from "@lervo/verification";

import { toolEnvironment, type ToolEnvironmentDetection } from "./tool-environment.js";

/**
 * The environment verification commands run in: the owner's login-shell PATH (ADR-0536). Under the
 * service manager's minimal PATH a suite's own tools, such as `pnpm` for the isolated workspace,
 * were missing and every canonical integration failed.
 */
export async function verificationEnvironment(
  detect?: ToolEnvironmentDetection,
): Promise<NodeJS.ProcessEnv> {
  return (await toolEnvironment(detect)).environment;
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
