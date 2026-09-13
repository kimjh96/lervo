import {
  inspectProviderLoginProbe,
  providerLoginEnvironment,
  type ProviderLoginContext,
} from "@lervo/adapter-contract";

export function codexStoredLoginEnvironment(context: ProviderLoginContext): Record<string, string> {
  return { ...providerLoginEnvironment(context), CODEX_HOME: context.configurationDirectory };
}

/** Reports native stored-login status; it does not validate a service request or permission. */
export function inspectCodexLogin(executable: string, context: ProviderLoginContext) {
  return inspectProviderLoginProbe({
    provider: "codex",
    executable,
    arguments: ["login", "status"],
    workingDirectory: context.homeDirectory,
    environment: codexStoredLoginEnvironment(context),
    parse: (code, stdout, stderr) => {
      const lines = `${stdout}\n${stderr}`
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length !== 1) return "unobserved";
      const line = lines[0]!;
      if (
        code === 0 &&
        (line === "Logged in using ChatGPT" ||
          /^Logged in using an API key(?: - [\x20-\x7e]{1,200})?$/u.test(line))
      )
        return "login_present";
      if (code === 1 && line === "Not logged in") return "login_absent";
      return "unobserved";
    },
  });
}
