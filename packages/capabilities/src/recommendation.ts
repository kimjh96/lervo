import { capabilityRoot, compareCapabilityVersions, discoverCapabilityRoot } from "./resolution.js";
import type { CapabilityRecommendation, DiscoveredCapability } from "./types.js";

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(/\s+/u)
      .filter((item) => item.length >= 2),
  );
}

function compatible(
  candidate: DiscoveredCapability,
  provider: string,
  platform: NodeJS.Platform,
): boolean {
  const providers = candidate.manifest.compatibility.providers;
  return (
    candidate.manifest.compatibility.platforms.includes(platform as never) &&
    (providers.mode === "any" || providers.providers.includes(provider as never))
  );
}

function scored(candidate: DiscoveredCapability, query: string): CapabilityRecommendation | null {
  const discovery = candidate.manifest.discovery;
  if (discovery === undefined || !discovery.autoSelect) return null;
  const queryText = normalized(query);
  const queryTokens = tokens(query);
  const reasons = new Set<CapabilityRecommendation["reasonCodes"][number]>();
  let score = 0;
  for (const intent of discovery.intents) {
    const phrase = normalized(intent);
    if (phrase.length >= 3 && queryText.includes(phrase)) {
      score += 10;
      reasons.add("intent_phrase");
    }
  }
  for (const keyword of discovery.keywords) {
    if ([...tokens(keyword)].some((token) => queryTokens.has(token))) {
      score += 3;
      reasons.add("keyword");
    }
  }
  const identity = tokens(`${candidate.manifest.capabilityId} ${discovery.displayName}`);
  for (const token of identity)
    if (queryTokens.has(token)) {
      score += 1;
      reasons.add("identity_token");
    }
  if (score < 6) return null;
  return {
    capabilityId: candidate.manifest.capabilityId,
    kind: candidate.manifest.kind,
    version: candidate.manifest.version,
    contentHash: candidate.manifest.contentHash,
    score,
    reasonCodes: [...reasons].sort(),
  };
}

export async function recommendCapabilities(input: {
  repositoryRoot: string;
  query: string;
  provider: string;
  platform: NodeJS.Platform;
  userRoot?: string;
  maximum?: number;
}): Promise<CapabilityRecommendation[]> {
  const candidates = [
    ...(await discoverCapabilityRoot(capabilityRoot(input.repositoryRoot, "project"), "project")),
    ...(await discoverCapabilityRoot(
      capabilityRoot(input.repositoryRoot, "user", input.userRoot),
      "user",
    )),
  ]
    .filter((candidate) => compatible(candidate, input.provider, input.platform))
    .sort((left, right) =>
      left.source.kind === right.source.kind
        ? compareCapabilityVersions(right.manifest.version, left.manifest.version)
        : left.source.kind === "project"
          ? -1
          : 1,
    );
  const byId = new Map<string, CapabilityRecommendation>();
  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.manifest.capabilityId)) continue;
    seenIds.add(candidate.manifest.capabilityId);
    const value = scored(candidate, input.query);
    if (value === null) continue;
    byId.set(value.capabilityId, value);
  }
  return [...byId.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.capabilityId.localeCompare(right.capabilityId),
    )
    .slice(0, Math.min(input.maximum ?? 8, 8));
}
