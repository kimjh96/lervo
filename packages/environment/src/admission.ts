import type {
  EnvironmentAdmissionPolicy,
  EnvironmentAdmissionResult,
  EnvironmentSourceCandidate,
} from "./types.js";
import { validateEnvironmentAdmissionPolicy, validateEnvironmentSourceManifest } from "./validation.js";

export function evaluateEnvironmentSourceCandidate(
  candidate: EnvironmentSourceCandidate,
  policyValue: EnvironmentAdmissionPolicy,
): EnvironmentAdmissionResult {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/.test(candidate.discoveredBy) ||
    !Array.isArray(candidate.evidence) || candidate.evidence.length === 0 || candidate.evidence.length > 16 ||
    candidate.evidence.some((item) =>
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/.test(item.kind) || !Number.isFinite(Date.parse(item.observedAt)))) {
    throw new Error("The environment source candidate evidence is invalid.");
  }
  const manifest = validateEnvironmentSourceManifest(candidate.manifest);
  const policy = validateEnvironmentAdmissionPolicy(policyValue);
  const rule = policy.rules.find((item) =>
    item.adapterId === manifest.adapterId &&
    (item.scopes === undefined || item.scopes.includes(manifest.scope)) &&
    (item.capabilities === undefined || manifest.capabilities.every((capability) => item.capabilities?.includes(capability))),
  );
  return rule === undefined
    ? { decision: policy.defaultDecision, ruleId: null, reason: "default_policy" }
    : { decision: rule.decision, ruleId: rule.ruleId, reason: "matching_rule" };
}
