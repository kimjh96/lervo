import type { ManagedConversationProviderSessionPort } from "./types.js";

/** Process-local default; distributed runners can inject a durable indexed port. */
export class MemoryConversationProviderSessionRegistry implements ManagedConversationProviderSessionPort {
  private readonly claims = new Set<string>();

  async claim(input: Parameters<ManagedConversationProviderSessionPort["claim"]>[0]) {
    const key = `${input.provider}:${input.providerSessionId}`;
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }
}
