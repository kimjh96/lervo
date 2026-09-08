import type {
  ConversationResponseActivity,
  HandleConversationEventResult,
} from "@lervo/interaction";

interface ActiveConversationResponse {
  activity: ConversationResponseActivity;
  lease: ReturnType<ConversationResponseActivity["start"]> | null;
  pendingBindings: Set<string>;
  timeout: ReturnType<typeof setTimeout>;
}

function bindingKey(policyId: string, roleId: string): string {
  return `${policyId}\0${roleId}`;
}

export class ConversationResponseActivityRegistry {
  private readonly active = new Map<string, ActiveConversationResponse>();

  constructor(private readonly maximumDurationMs = 5 * 60_000) {
    if (
      !Number.isSafeInteger(maximumDurationMs) ||
      maximumDurationMs < 10_000 ||
      maximumDurationMs > 15 * 60_000
    ) {
      throw new Error("The conversation response activity duration is invalid.");
    }
  }

  bind(
    eventId: string,
    bindings: readonly { policyId: string; roleId: string }[],
    activity?: ConversationResponseActivity,
  ): ConversationResponseActivity | undefined {
    let record = this.active.get(eventId);
    if (record === undefined && activity !== undefined) {
      const timeout = setTimeout(() => this.stop(eventId), this.maximumDurationMs);
      timeout.unref();
      record = {
        activity,
        lease: null,
        pendingBindings: new Set(),
        timeout,
      };
      this.active.set(eventId, record);
    }
    if (record === undefined) return undefined;
    for (const binding of bindings) {
      record.pendingBindings.add(bindingKey(binding.policyId, binding.roleId));
    }
    return {
      start: () => {
        if (record!.lease === null) record!.lease = record!.activity.start();
        return { stop() {} };
      },
    };
  }

  settle(
    eventId: string,
    binding: { policyId: string; roleId: string },
    result: HandleConversationEventResult,
  ): void {
    const record = this.active.get(eventId);
    if (record === undefined) return;
    if (result.status !== "retry_scheduled") {
      record.pendingBindings.delete(bindingKey(binding.policyId, binding.roleId));
    }
    if (record.pendingBindings.size === 0) this.stop(eventId);
  }

  close(): void {
    for (const eventId of this.active.keys()) this.stop(eventId);
  }

  abort(eventId: string): void {
    this.stop(eventId);
  }

  private stop(eventId: string): void {
    const record = this.active.get(eventId);
    if (record === undefined) return;
    this.active.delete(eventId);
    clearTimeout(record.timeout);
    try {
      record.lease?.stop();
    } catch {
      // Platform activity is best-effort and cannot change the response outcome.
    }
  }
}
