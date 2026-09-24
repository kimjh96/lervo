import { asRecord, integer, text } from "./normalization-utils.js";

/**
 * Sums each assistant API message's reported usage per turn so a budget can stop a turn before
 * its final result. The sum is a lower bound for enforcement, never accounting evidence.
 */
export class ClaudeTurnUsageEstimator {
  /** Per turn, the largest observed token count of each provider API message. */
  private readonly turns = new Map<string, Map<string, number>>();

  observe(providerTurnId: string, message: Record<string, unknown>): number | null {
    const body = asRecord(message.message);
    const messageId = text(body?.id);
    const usage = asRecord(body?.usage);
    if (messageId === undefined || usage === undefined) return null;
    const counts = [
      usage.input_tokens,
      usage.cache_read_input_tokens ?? 0,
      usage.cache_creation_input_tokens ?? 0,
      usage.output_tokens,
    ].map((value) => integer(value));
    if (counts.some((value) => value === null || value < 0)) return null;
    const messages = this.turns.get(providerTurnId) ?? new Map<string, number>();
    const tokens = counts.reduce<number>((sum, value) => sum + value!, 0);
    messages.set(messageId, Math.max(messages.get(messageId) ?? 0, tokens));
    this.turns.set(providerTurnId, messages);
    let totalTokens = 0;
    for (const value of messages.values()) totalTokens += value;
    return totalTokens;
  }
}
