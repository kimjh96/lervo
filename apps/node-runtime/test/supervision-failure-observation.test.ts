import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FileSystemCas } from "@lervo/cas";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  providerRunInput,
  runId,
} from "../../../packages/orchestrator/test/fixture.js";
import { coordinator } from "../../../packages/orchestrator/test/managed-provider-run-test-harness.js";
import { FakeManagedAdapter } from "../../../packages/orchestrator/test/provider-run-fake-adapter.js";
import { observeSupervisionFailure } from "../src/supervision-failure-observation.js";

afterEach(cleanupManagedFixtures);

class NoToolFixture extends FakeManagedAdapter {
  constructor(provider: "codex" | "claude", failStop: boolean) {
    super(provider, { failResult: true, failStop });
    Object.assign(this.descriptor.capabilities, {
      toolCalls: "unsupported",
      commandExecution: "unsupported",
      fileChanges: "unsupported",
    });
  }
  override async *events(...args: Parameters<FakeManagedAdapter["events"]>) {
    for await (const event of super.events(...args))
      if (!["provider.tool.called", "provider.command.executed"].includes(event.type)) yield event;
  }
}

it.each(["codex", "claude"] as const)(
  "requires exact no-tool session and settled failure evidence (%s)",
  async (provider) => {
    const data = await createManagedFixture();
    const artifacts = await FileSystemCas.open(resolve(data.root, ".lervo/state/cas"));
    const adapter = new NoToolFixture(provider, false);
    try {
      await expect(
        coordinator(adapter, data.root, data.store, undefined, artifacts).run({
          ...providerRunInput(),
          repositoryRoot: data.root,
        }),
      ).rejects.toMatchObject({ code: "provider_result_failed" });
      const events = data.store.list({ runId });
      expect(await observeSupervisionFailure(events, artifacts)).toMatchObject({
        status: "known_safe_failure",
        reasonCode: "settled_no_tool_failure",
      });
      expect(
        await observeSupervisionFailure(
          events.filter((event) => event.type !== "adapter.stopped"),
          artifacts,
        ),
      ).toMatchObject({ status: "uncertain" });
      const widened = structuredClone(events);
      const start = widened.find((event) => event.type === "adapter.started")!;
      (start.payload.capabilities as Record<string, unknown>).toolCalls = "supported";
      expect(await observeSupervisionFailure(widened, artifacts)).toMatchObject({
        status: "uncertain",
      });
      const missing = structuredClone(events);
      missing.find((event) => event.type === "run.failed")!.payload.diagnosticDigest =
        "sha256:" + "0".repeat(64);
      expect(await observeSupervisionFailure(missing, artifacts)).toMatchObject({
        status: "uncertain",
        reasonCode: "failure_diagnostic_unavailable",
      });
    } finally {
      data.store.close();
    }
  },
);

it("retains uncertainty when provider stop fails even without tools", async () => {
  const data = await createManagedFixture();
  const artifacts = await FileSystemCas.open(resolve(data.root, ".lervo/state/cas"));
  try {
    await expect(
      coordinator(
        new NoToolFixture("codex", true),
        data.root,
        data.store,
        undefined,
        artifacts,
      ).run({ ...providerRunInput(), repositoryRoot: data.root }),
    ).rejects.toMatchObject({ code: "provider_stop_failed" });
    expect(await observeSupervisionFailure(data.store.list({ runId }), artifacts)).toMatchObject({
      status: "uncertain",
    });
  } finally {
    data.store.close();
  }
});
