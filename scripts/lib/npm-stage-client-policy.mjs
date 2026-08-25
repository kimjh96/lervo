import { containsNpmCredential } from "./npm-interactive-first-publication-policy.mjs";

const minimumNpmVersion = [11, 15, 0];

export function isSupportedNpmStageClient(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(value?.trim() ?? "");
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let index = 0; index < minimumNpmVersion.length; index += 1) {
    if (actual[index] !== minimumNpmVersion[index]) {
      return actual[index] > minimumNpmVersion[index];
    }
  }
  return true;
}

export function withoutNpmConfiguration(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.toLowerCase().startsWith("npm_config_")),
  );
}

export function npmStageEnvironmentReasons({
  environment = {},
  interactive = false,
  stdinIsTTY = false,
  stdoutIsTTY = false,
  stderrIsTTY = false,
}) {
  const reasons = [];
  if (containsNpmCredential(environment)) reasons.push("environment_credential_detected");
  if (interactive && (!stdinIsTTY || !stdoutIsTTY || !stderrIsTTY)) {
    reasons.push("terminal_not_interactive");
  }
  if (interactive && (environment.CI === "true" || environment.GITHUB_ACTIONS === "true")) {
    reasons.push("automation_environment_detected");
  }
  return reasons;
}
