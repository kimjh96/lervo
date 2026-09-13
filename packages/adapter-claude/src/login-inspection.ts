import {
  inspectProviderLoginProbe,
  providerLoginEnvironment,
  type ProviderLoginContext,
} from "@lervo/adapter-contract";

export function claudeStoredLoginEnvironment(
  context: ProviderLoginContext,
): Record<string, string> {
  return {
    ...providerLoginEnvironment(context),
    CLAUDE_CONFIG_DIR: context.configurationDirectory,
  };
}

/** Account fields are discarded; a local login report proves no remote service authority. */
export function inspectClaudeLogin(executable: string, context: ProviderLoginContext) {
  return inspectProviderLoginProbe({
    provider: "claude",
    executable,
    arguments: ["auth", "status", "--json"],
    workingDirectory: context.homeDirectory,
    environment: claudeStoredLoginEnvironment(context),
    parse: (code, stdout, stderr) => {
      if (stderr.trim() !== "") return "unobserved";
      const value = JSON.parse(stdout) as { loggedIn?: unknown } | null;
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.hasOwn(value, "loggedIn")
      )
        return "unobserved";
      if (code === 0 && value.loggedIn === true) return "login_present";
      if ((code === 0 || code === 1) && value.loggedIn === false) return "login_absent";
      return "unobserved";
    },
  });
}
