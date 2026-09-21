import type { ConversationResponder } from "@lervo/interaction";

/** Breaks the composition cycle between effect discovery and the managed result responder. */
export class ConversationEffectResultResponderBinding implements ConversationResponder {
  private delegate: ConversationResponder | null = null;

  bind(delegate: ConversationResponder): void {
    if (this.delegate !== null) {
      throw new Error("The conversation effect result responder is already bound.");
    }
    this.delegate = delegate;
  }

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    if (this.delegate === null) {
      throw new Error("The conversation effect result responder is not bound.");
    }
    return this.delegate.respond(input);
  }
}
