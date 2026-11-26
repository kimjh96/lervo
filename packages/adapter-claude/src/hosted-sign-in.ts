import { homedir } from "node:os";
import { join } from "node:path";

import { inspectClaudeLogin } from "./login-inspection.js";

/**
 * Whether someone is signed in to Claude Code (Lervo ADE projects, "Provider sign-in"), through
 * the adapter's login inspection: it runs `claude auth status --json` with a scrubbed environment,
 * keeps no account field, and counts a lapsed access token with a live refresh token as signed in.
 * An inspection that cannot tell, or fails, is `null`, so an unknown state never blocks work.
 */
export async function claudeSignInState(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean | null> {
  const home = environment.HOME ?? homedir();
  const context = {
    homeDirectory: home,
    configurationDirectory: environment.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
  };
  const result = await inspectClaudeLogin(executable, context).catch(() => null);
  if (result?.status === "login_present") return true;
  if (result?.status === "login_absent") return false;
  return null;
}
