const minimumNpmVersion = [11, 5, 1];
const reasons = new Set([
  "terminal_not_interactive",
  "automation_environment_detected",
  "registry_credential_in_environment",
  "npm_client_unavailable",
  "npm_client_unsupported",
  "npm_profile_unavailable",
  "npm_write_2fa_not_ready",
]);

function version(value) {
  if (typeof value !== "string") return undefined;
  return /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(value.trim())?.slice(1).map(Number);
}

function supported(actual) {
  if (!actual) return false;
  for (let index = 0; index < minimumNpmVersion.length; index += 1) {
    if (actual[index] > minimumNpmVersion[index]) return true;
    if (actual[index] < minimumNpmVersion[index]) return false;
  }
  return true;
}

export function isSupportedNpmInteractiveClient(value) {
  return supported(version(value));
}

export function containsNpmCredential(environment) {
  return Object.entries(environment ?? {}).some(([name, value]) => {
    if (typeof value !== "string" || value.length === 0) return false;
    const normalized = name.toLowerCase();
    return ["npm_token", "node_auth_token", "pnpm_token"].includes(normalized) ||
      (normalized.startsWith("npm_config_") &&
        ["auth", "otp", "token"].some((part) => normalized.includes(part)));
  });
}

export function npmInteractiveFirstPublicationEnvironmentReasons({
  environment = {}, stdinIsTTY, stdoutIsTTY, stderrIsTTY,
}) {
  const found = [];
  if (!stdinIsTTY || !stdoutIsTTY || !stderrIsTTY) found.push("terminal_not_interactive");
  if (environment.CI === "true" || environment.GITHUB_ACTIONS === "true") {
    found.push("automation_environment_detected");
  }
  if (containsNpmCredential(environment)) found.push("registry_credential_in_environment");
  return found;
}

export function createNpmInteractiveFirstPublicationObservation({
  npmVersion,
  profile,
  environment = {},
  stdinIsTTY,
  stdoutIsTTY,
  stderrIsTTY,
  clientObserved = true,
  profileObserved = true,
}) {
  const found = npmInteractiveFirstPublicationEnvironmentReasons({
    environment, stdinIsTTY, stdoutIsTTY, stderrIsTTY,
  });
  if (!clientObserved) found.push("npm_client_unavailable");
  else if (!isSupportedNpmInteractiveClient(npmVersion)) found.push("npm_client_unsupported");
  if (!profileObserved) found.push("npm_profile_unavailable");
  else if (profile?.tfa?.mode !== "auth-and-writes" || profile.tfa.pending === true) {
    found.push("npm_write_2fa_not_ready");
  }
  return createNpmInteractiveFirstPublicationObservationFromReasons(found);
}

export function createNpmInteractiveFirstPublicationObservationFromReasons(found) {
  if (!Array.isArray(found) || found.some((reason) => !reasons.has(reason)) ||
      new Set(found).size !== found.length) {
    throw new TypeError("npm interactive first-publication reasons are invalid");
  }
  const state = found.some((reason) => [
    "npm_client_unavailable", "npm_profile_unavailable",
  ].includes(reason)) ? "unavailable" : found.length === 0 ? "ready" : "blocked";
  return {
    schemaVersion: 1,
    source: "npm_interactive_first_publication",
    state,
    reasons: found,
  };
}

export function validateNpmInteractiveFirstPublicationObservation(observation) {
  if (
    observation?.schemaVersion !== 1 ||
    observation.source !== "npm_interactive_first_publication" ||
    !["ready", "blocked", "unavailable"].includes(observation.state) ||
    !Array.isArray(observation.reasons) ||
    observation.reasons.some((reason) => !reasons.has(reason)) ||
    new Set(observation.reasons).size !== observation.reasons.length ||
    (observation.state === "ready") !== (observation.reasons.length === 0) ||
    (observation.state === "unavailable") !== observation.reasons.some((reason) => [
      "npm_client_unavailable", "npm_profile_unavailable",
    ].includes(reason)) ||
    Object.keys(observation).length !== 4
  ) throw new TypeError("npm interactive first-publication observation is invalid");
  return observation;
}
