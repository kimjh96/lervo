import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  inspectProviderLoginProbe,
  providerLoginEnvironment,
  type ProviderLoginContext,
} from "@lervo/adapter-contract";

/**
 * The environment of a Claude Code process that uses the stored login. `CLAUDE_CONFIG_DIR` is set
 * only for a directory other than the default `~/.claude`: on macOS, Claude Code names its
 * keychain entry after an explicit `CLAUDE_CONFIG_DIR`, so setting even the default path makes it
 * look for another entry and report no login.
 */
export function claudeStoredLoginEnvironment(
  context: ProviderLoginContext,
): Record<string, string> {
  const environment = providerLoginEnvironment(context);
  return resolve(context.configurationDirectory) === resolve(context.homeDirectory, ".claude")
    ? environment
    : { ...environment, CLAUDE_CONFIG_DIR: context.configurationDirectory };
}

const REFRESH_MARGIN_MS = 10 * 60_000;

/**
 * Claude Code refreshes a lapsed OAuth access token on its next real request, but `auth status`
 * cannot report that state. Only the refresh token's presence and expiry are read; no token value
 * leaves this function.
 */
async function refreshableStoredLogin(context: ProviderLoginContext, nowMs: number) {
  try {
    const raw = JSON.parse(
      await readFile(join(context.configurationDirectory, ".credentials.json"), "utf8"),
    ) as { claudeAiOauth?: { refreshToken?: unknown; refreshTokenExpiresAt?: unknown } } | null;
    const oauth = raw?.claudeAiOauth;
    return (
      typeof oauth?.refreshToken === "string" &&
      oauth.refreshToken.length > 0 &&
      typeof oauth.refreshTokenExpiresAt === "number" &&
      oauth.refreshTokenExpiresAt > nowMs + REFRESH_MARGIN_MS
    );
  } catch {
    return false;
  }
}

/** Account fields are discarded; a local login report proves no remote service authority. */
export async function inspectClaudeLogin(
  executable: string,
  context: ProviderLoginContext,
  now: () => number = Date.now,
) {
  const probed = await probeClaudeLogin(executable, context);
  // An unanswered status probe is not a logout: a stored refreshable login still authorizes a run.
  if (
    probed.status === "unobserved" &&
    ["unrecognized_response", "probe_timed_out", "probe_failed"].includes(probed.reasonCode) &&
    (await refreshableStoredLogin(context, now()))
  )
    return {
      ...probed,
      status: "login_present" as const,
      reasonCode: "native_login_present" as const,
    };
  return probed;
}

function probeClaudeLogin(executable: string, context: ProviderLoginContext) {
  return inspectProviderLoginProbe({
    provider: "claude",
    executable,
    arguments: ["auth", "status", "--json"],
    // A hung probe falls back to the stored login, which must still fit the five-second
    // readiness window that callers apply to the whole inspection.
    timeoutMs: 3000,
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
