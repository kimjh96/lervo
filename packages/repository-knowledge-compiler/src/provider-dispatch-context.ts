import { tmpdir } from "node:os";
import { parse } from "node:path";

export const PROVIDER_CLI_DISPATCH_POLICY = "filesystem-root-allowlist-v1";

/** A stable neutral cwd prevents shims from selecting a checkout or scratch-specific CLI. */
export function providerCliDispatchContext(environment?: NodeJS.ProcessEnv): {
  cwd: string;
  environment: NodeJS.ProcessEnv;
} {
  const inherited = { ...process.env, ...environment };
  const result: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "Path",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "USERPROFILE",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "TMPDIR",
    "TEMP",
    "TMP",
  ]) {
    const value = inherited[name];
    if (value !== undefined) result[name] = value;
  }
  return { cwd: parse(tmpdir()).root, environment: result };
}
