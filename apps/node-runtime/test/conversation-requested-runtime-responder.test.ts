import type { ConversationResponder } from "@lervo/interaction";
import { describe, expect, it, vi } from "vitest";

import { ConversationRequestedRuntimeManager } from "../src/conversation-requested-runtime.js";
import { ConversationRequestedRuntimeResponder } from "../src/conversation-requested-runtime-responder.js";
describe("conversation requested runtime responder", () => {
  it("passes observed runtime outcomes to the agent's managed conversation responder", async () => {
    const candidate = {} as Awaited<ReturnType<ConversationResponder["respond"]>>;
    const resultResponder = { respond: vi.fn(async () => candidate) };
    let exit!: () => void;
    const stop = vi.fn(async () => exit());
    const manager = new ConversationRequestedRuntimeManager(
      [
        {
          runtimeId: "preview",
          displayName: "Development server",
          executable: "/usr/bin/node",
          arguments: [],
          workingDirectory: "/workspace",
          maximumLifetimeMs: 60_000,
          startupTimeoutMs: 5_000,
          stopTimeoutMs: 1_000,
        },
      ],
      {
        start: async () => ({
          exited: new Promise((resolve) => {
            exit = () => resolve({ exitCode: null, signal: "SIGTERM" });
          }),
          stop,
        }),
      },
    );
    const responder = new ConversationRequestedRuntimeResponder(manager, resultResponder);
    const request = { context: { priorTurns: [] } } as unknown as Parameters<
      ConversationRequestedRuntimeResponder["respond"]
    >[0];

    const opened = await responder.respond(
      request,
      { kind: "requested_runtime_open", specification: "preview" },
      { effectRequesterAuthorized: true },
    );
    expect(opened).toBe(candidate);
    expect(resultResponder.respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: {
          priorTurns: [],
          completedEffect: {
            effectId: "requested_runtime_open",
            resultCode: "opened",
            targetLabel: "Development server",
            facts: [
              "The configured runtime started successfully.",
              "Its configured startup readiness contract completed.",
              "It was not enabled at boot or configured for unconditional restart.",
            ],
          },
        },
      }),
    );

    await responder.respond(
      request,
      { kind: "requested_runtime_close", specification: "preview" },
      { effectRequesterAuthorized: true },
    );
    expect(resultResponder.respond).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: {
          priorTurns: [],
          completedEffect: {
            effectId: "requested_runtime_close",
            resultCode: "closed",
            targetLabel: "Development server",
            facts: ["The configured runtime stopped successfully."],
          },
        },
      }),
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it("lets the same agent explain an observed startup failure without leaking the thrown error", async () => {
    const candidate = {} as Awaited<ReturnType<ConversationResponder["respond"]>>;
    const resultResponder = { respond: vi.fn(async () => candidate) };
    const manager = new ConversationRequestedRuntimeManager(
      [
        {
          runtimeId: "preview",
          displayName: "Development server",
          executable: "/private/provider/path",
          arguments: [],
          workingDirectory: "/workspace",
          maximumLifetimeMs: 60_000,
          startupTimeoutMs: 5_000,
          stopTimeoutMs: 1_000,
        },
      ],
      {
        start: async () => {
          throw new Error("private launch failure: /private/provider/path");
        },
      },
    );
    const responder = new ConversationRequestedRuntimeResponder(manager, resultResponder);
    const request = { context: { priorTurns: [] } } as unknown as Parameters<
      ConversationRequestedRuntimeResponder["respond"]
    >[0];

    await expect(
      responder.respond(
        request,
        { kind: "requested_runtime_open", specification: "preview" },
        { effectRequesterAuthorized: true },
      ),
    ).resolves.toBe(candidate);
    expect(resultResponder.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          priorTurns: [],
          completedEffect: {
            effectId: "requested_runtime_open",
            resultCode: "start_failed",
            targetLabel: "Development server",
            facts: [
              "The configured runtime could not be started.",
              "No successful start was recorded.",
            ],
          },
        },
      }),
    );
    expect(JSON.stringify(resultResponder.respond.mock.calls)).not.toContain(
      "private launch failure",
    );
    expect(JSON.stringify(resultResponder.respond.mock.calls)).not.toContain(
      "/private/provider/path",
    );
  });
});
