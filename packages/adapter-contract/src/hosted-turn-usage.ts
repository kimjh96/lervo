// What a hosted session's turns cost, as the provider reported them (ADR-0632, S2b; Lervo ADE
// sessions, "Usage records"). Counts and amounts only: never the turn's text. The core records
// them as `resource.usage.recorded` with a hosted-session attribution.
import { hostedModelIdPattern, type ResourceAccountingDescriptor } from "@lervo/schemas";

/** One model's usage in one turn, as the provider counted it. */
export interface HostedTurnUsage {
  /**
   * The provider's own identifier of the turn's result, such as its UUID. With the session and
   * the model key it names the record, so a replayed decode records nothing twice. It is
   * digested before it leaves the host.
   */
  readonly turnKey: string;
  /** The result's position within the provider's process; informational. */
  readonly resultIndex: number;
  /** The provider's own key for the model in this result; only ever digested. */
  readonly modelKey: string;
  /** The model's safe name, such as `claude-opus-5-5[1m]`, or null when it has none. */
  readonly model: string | null;
  /** Input the provider did not read from or write to its cache. */
  readonly uncachedInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  /** Part of `outputTokens`, not added to it; null when the provider did not report it. */
  readonly reasoningOutputTokens: number | null;
  readonly contextWindow: number | null;
  /** An estimate at the provider's list price, or null when the provider reported no cost. */
  readonly costUsd: number | null;
  readonly costBasis: "list" | "unreported";
}

/**
 * A stream decoder that also reports each finished turn's usage. The caller takes it after each
 * output; a turn without reported usage reports nothing, never zeros. `usageAccounting` names
 * the provider's counter semantics, which the core stores before the first record citing it.
 */
export interface HostedUsageReporting {
  takeUsage(): readonly HostedTurnUsage[];
  usageAccounting(): ResourceAccountingDescriptor;
}

/** Whether a decoder reports usage. */
export function reportsUsage(decoder: object): decoder is HostedUsageReporting {
  const candidate = decoder as Partial<HostedUsageReporting>;
  return (
    typeof candidate.takeUsage === "function" && typeof candidate.usageAccounting === "function"
  );
}

/** The model identifier hosted usage records accept, a bracketed tier included: the schema's own. */
const HOSTED_MODEL = new RegExp(hostedModelIdPattern, "u");

/**
 * The model name a usage record may carry: the provider's own, such as `claude-opus-5-5[1m]`,
 * when it is a safe name. A cloud ARN is reduced to the part after its last `/`, so no account
 * identifier is recorded. Anything else has no name, and the record says the model is
 * unavailable while keeping its counts.
 */
export function usageModelName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  // An ARN without a resource path is all account and region: nothing of it is recorded.
  if (name.startsWith("arn:") && !name.includes("/")) return null;
  const model = name.startsWith("arn:") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return HOSTED_MODEL.test(model) ? model : null;
}
