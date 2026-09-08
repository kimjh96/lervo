import { describe, expect, it, vi } from "vitest";

import { ConversationResponseActivityRegistry } from "../src/response-activity.js";

const binding = { policyId: `cpp_${"a".repeat(64)}`, roleId: "developer" };

describe("conversation response activity registry", () => {
  it("keeps one activity lease across a scheduled retry and stops it on terminal completion", () => {
    const stop = vi.fn();
    const start = vi.fn(() => ({ stop }));
    const registry = new ConversationResponseActivityRegistry(10_000);
    const first = registry.bind("cve_response01", [binding], { start });

    first?.start().stop();
    registry.settle("cve_response01", binding, {
      status: "retry_scheduled",
      failureCode: "response_generation_failed",
      nextAttemptAt: "2026-09-08T12:00:01.000Z",
    });
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();

    const retry = registry.bind("cve_response01", [], undefined);
    retry?.start().stop();
    expect(start).toHaveBeenCalledOnce();
    registry.settle("cve_response01", binding, { status: "busy" });
    expect(stop).toHaveBeenCalledOnce();
    registry.close();
    expect(stop).toHaveBeenCalledOnce();
  });
});
