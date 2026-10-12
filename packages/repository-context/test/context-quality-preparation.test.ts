import { afterEach, describe, expect, it, vi } from "vitest";
import { unavailableContextQualityBindings } from "@lervo/context";
import {
  prepareContextQuality,
  type ContextQualityPreparationPorts,
} from "../src/context-quality-preparation.js";
import { qualityFixture, qualityHash } from "./context-quality-fixture.js";

function setup() {
  const fixture = qualityFixture();
  const controller = new AbortController();
  const ports: ContextQualityPreparationPorts = {
    resolveBindings: vi.fn(async () => ({
      status: "resolved" as const,
      bindings: fixture.bindings,
    })),
    prepare: vi.fn(async () => ({ evidence: fixture.evidence, sources: fixture.sources })),
    revalidate: vi.fn(async () => fixture.bindings),
  };
  return {
    fixture,
    controller,
    ports,
    input: {
      ingress: fixture.ingress,
      deadlineMs: 1000,
      signal: controller.signal,
      now: () => performance.now(),
      ports,
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("private context quality preparation", () => {
  it("uses the same semantic plan across supported origin kinds", async () => {
    const digests = [];
    for (const kind of ["terminal", "managed_run", "conversation", "native_chat"] as const) {
      const { input } = setup();
      input.ingress.origin.kind = kind;
      const result = await prepareContextQuality(input);
      expect(result.status).toBe("ready");
      digests.push(result.plan?.planDigest);
    }
    expect(new Set(digests).size).toBe(1);
  });

  it("does not prepare when trusted bindings are missing", async () => {
    const { input, ports } = setup();
    ports.resolveBindings = vi.fn(async () =>
      unavailableContextQualityBindings(["authority_scope", "applicable_policy"]),
    );
    expect(await prepareContextQuality(input)).toMatchObject({
      status: "unavailable",
      plan: null,
      missingBindings: ["applicable_policy", "authority_scope"],
    });
    expect(ports.prepare).not.toHaveBeenCalled();
    expect(ports.revalidate).not.toHaveBeenCalled();
  });

  it("does not invoke ports for an already cancelled attempt", async () => {
    const { input, ports, controller } = setup();
    controller.abort();
    expect(await prepareContextQuality(input)).toMatchObject({ status: "cancelled", plan: null });
    expect(ports.resolveBindings).not.toHaveBeenCalled();
  });

  it("detaches from a pending port and never promotes its late completion", async () => {
    const { input, ports, controller, fixture } = setup();
    let finish!: (value: Awaited<ReturnType<ContextQualityPreparationPorts["prepare"]>>) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    ports.prepare = vi.fn(() => {
      started();
      return new Promise<Awaited<ReturnType<ContextQualityPreparationPorts["prepare"]>>>(
        (resolve) => {
          finish = resolve;
        },
      );
    });
    const pending = prepareContextQuality(input);
    await entered;
    controller.abort();
    expect(await pending).toMatchObject({ status: "cancelled", plan: null });
    finish({ evidence: fixture.evidence, sources: fixture.sources });
    await Promise.resolve();
    expect(ports.revalidate).not.toHaveBeenCalled();
  });

  it("bounds a hung resolver by the attempt deadline", async () => {
    vi.useFakeTimers();
    const { input, ports } = setup();
    ports.resolveBindings = vi.fn(() => new Promise<never>(() => undefined));
    const pending = prepareContextQuality(input);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({
      status: "unavailable",
      plan: null,
      reasonCodes: ["context_budget_exceeded"],
    });
  });

  it("includes resolution time in the tighter trusted profile deadline", async () => {
    const { input, fixture, ports } = setup();
    fixture.bindings.profile.deadlineMs = 10;
    let elapsed = 0;
    input.now = () => elapsed;
    ports.resolveBindings = vi.fn(async () => {
      elapsed = 11;
      return { status: "resolved" as const, bindings: fixture.bindings };
    });
    expect(await prepareContextQuality(input)).toMatchObject({
      reasonCodes: ["context_budget_exceeded"],
      plan: null,
    });
    expect(ports.prepare).not.toHaveBeenCalled();
  });

  it.each(["scope", "capability"])(
    "rejects changed %s bindings before returning a plan",
    async (change) => {
      const { input, fixture, ports } = setup();
      ports.revalidate = vi.fn(async () => {
        const current = structuredClone(fixture.bindings);
        if (change === "scope") current.scopeDigest = qualityHash("new-scope");
        else current.executionCapabilities.controlledProviderInput = true;
        return current;
      });
      expect(await prepareContextQuality(input)).toMatchObject({
        status: "stale",
        plan: null,
        reasonCodes: ["context_binding_stale"],
      });
    },
  );

  it("does not expose exception text from a trusted port", async () => {
    const { input, ports } = setup();
    ports.prepare = vi.fn(async () => {
      throw new Error("secret text /private/path");
    });
    const result = await prepareContextQuality(input);
    expect(result).toMatchObject({
      status: "unavailable",
      plan: null,
      reasonCodes: ["context_contract_invalid"],
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });
});
