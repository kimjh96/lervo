/**
 * ADR-0460 `provider_claim_unproven`: a reply may attribute opinions to more than one provider
 * only when it cites a deliberation whose participants' usage is verified. Otherwise the reply is
 * repaired into a statement of the one provider that actually produced it.
 */
export const PROVIDER_CLAIM_CHECK_ID = "provider_claim_unproven";

export type ClaimedProvider = "codex" | "claude";

export type ProviderClaimDisposition = "not_applicable" | "proven" | "repaired";

export interface ProviderClaimContext {
  /** The provider whose usage produced this reply, or null when it is not observed. */
  observedProvider: ClaimedProvider | null;
  /** Resolves whether a cited deliberation has verified usage for every participant. */
  isVerifiedDeliberation?: (deliberationId: string) => boolean | Promise<boolean>;
  /** Extra names that identify a provider in prose, such as bound agent display names. */
  aliases?: Readonly<Partial<Record<ClaimedProvider, readonly string[]>>>;
}

export interface ProviderClaimResult {
  checkId: typeof PROVIDER_CLAIM_CHECK_ID;
  disposition: ProviderClaimDisposition;
  content: string;
  claimedProviders: ClaimedProvider[];
  citedDeliberationIds: string[];
  verifiedDeliberationIds: string[];
}

/** Provider names and the model family names operators use for them (`gpt-6-sol` is "Sol"). */
const defaultProviderAliases: Readonly<Record<ClaimedProvider, readonly string[]>> = {
  codex: ["codex", "openai", "gpt", "sol", "astra", "코덱스"],
  claude: ["claude", "anthropic", "opus", "sonnet", "haiku", "클로드", "오퍼스", "소넷"],
};

const providerLabels: Readonly<Record<ClaimedProvider, string>> = {
  codex: "Codex",
  claude: "Claude",
};

const opinionPattern =
  /\b(?:opinions?|views?|perspectives?|takes?|positions?|assessments?|reviews?|reviewed|recommend(?:s|ed|ations?)?|agree(?:s|d|ment)?|disagree(?:s|d|ment)?|thinks?|believes?|argue(?:s|d)?|suggest(?:s|ed)?|says|said|prefers?|preferred)\b|의견|관점|견해|입장|검토|동의|반대|생각|판단|평가|주장|제안|선호/iu;

const deliberationReferencePattern = /\bdlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\b/gu;
const sentencePattern = /[^.!?。！？]+(?:[.!?。！？]+|$)\s*/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function aliasPattern(alias: string): RegExp {
  const escaped = escapeRegExp(alias);
  // Hangul has no word boundary; ASCII aliases must not match inside longer words.
  return /^[A-Za-z0-9]/u.test(alias)
    ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z])`, "iu")
    : new RegExp(escaped, "u");
}

function providerMatchers(context: ProviderClaimContext): [ClaimedProvider, RegExp[]][] {
  return (Object.keys(defaultProviderAliases) as ClaimedProvider[]).map((provider) => [
    provider,
    [...defaultProviderAliases[provider], ...(context.aliases?.[provider] ?? [])]
      .filter((alias) => alias.trim().length > 0)
      .map(aliasPattern),
  ]);
}

function providersNamedIn(
  text: string,
  matchers: readonly [ClaimedProvider, RegExp[]][],
): ClaimedProvider[] {
  return matchers
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(text)))
    .map(([provider]) => provider);
}

function sentences(line: string): string[] {
  return line.match(sentencePattern) ?? [line];
}

/** Providers to which the text attributes an opinion: named in a sentence that states one. */
function claimedProviders(
  text: string,
  matchers: readonly [ClaimedProvider, RegExp[]][],
): ClaimedProvider[] {
  const claimed = new Set<ClaimedProvider>();
  for (const line of text.split("\n")) {
    for (const sentence of sentences(line)) {
      if (!opinionPattern.test(sentence)) continue;
      for (const provider of providersNamedIn(sentence, matchers)) claimed.add(provider);
    }
  }
  return [...claimed].sort();
}

function singleProviderNote(text: string, provider: ClaimedProvider | null): string {
  const korean = /[가-힣]/u.test(text);
  if (provider === null) {
    return korean
      ? "참고: 이 답변은 한 공급자의 관점만 반영합니다. 여러 공급자의 의견을 비교한 검증된 토론 기록은 없습니다."
      : "Note: this reply reflects one provider's view only. No verified deliberation compared several providers' opinions.";
  }
  return korean
    ? `참고: 이 답변은 ${providerLabels[provider]} 한 공급자의 관점만 반영합니다. 여러 공급자의 의견을 비교한 검증된 토론 기록은 없습니다.`
    : `Note: this reply reflects the ${providerLabels[provider]} provider's view only. No verified deliberation compared several providers' opinions.`;
}

/**
 * Removes every opinion sentence attributed to a provider other than the observed one, or to
 * several providers at once, then states that the reply reflects a single provider.
 */
function repairToSingleProvider(
  text: string,
  context: ProviderClaimContext,
  matchers: readonly [ClaimedProvider, RegExp[]][],
): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      lines.push(line);
      continue;
    }
    const kept = sentences(line).filter((sentence) => {
      if (!opinionPattern.test(sentence)) return true;
      const named = providersNamedIn(sentence, matchers);
      if (named.length === 0) return true;
      return named.length === 1 && named[0] === context.observedProvider;
    });
    const rebuilt = kept.join("").trimEnd();
    if (rebuilt.trim().length > 0) lines.push(rebuilt);
  }
  const body = lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const note = singleProviderNote(text, context.observedProvider);
  return body.length === 0 ? note : `${body}\n\n${note}`;
}

export async function enforceProviderClaim(
  content: string,
  context: ProviderClaimContext,
): Promise<ProviderClaimResult> {
  const matchers = providerMatchers(context);
  const claimed = claimedProviders(content, matchers);
  const cited = [...new Set(content.match(deliberationReferencePattern) ?? [])].sort();
  const base = {
    checkId: PROVIDER_CLAIM_CHECK_ID,
    claimedProviders: claimed,
    citedDeliberationIds: cited,
  } as const;
  if (claimed.length < 2) {
    return { ...base, disposition: "not_applicable", content, verifiedDeliberationIds: [] };
  }
  const verified: string[] = [];
  for (const deliberationId of cited) {
    if ((await context.isVerifiedDeliberation?.(deliberationId)) === true) {
      verified.push(deliberationId);
    }
  }
  if (verified.length > 0) {
    return { ...base, disposition: "proven", content, verifiedDeliberationIds: verified };
  }
  return {
    ...base,
    disposition: "repaired",
    content: repairToSingleProvider(content, context, matchers),
    verifiedDeliberationIds: [],
  };
}
