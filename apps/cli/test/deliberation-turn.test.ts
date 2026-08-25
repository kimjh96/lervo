import { DeliberationRuntimeError } from "@lervo/deliberation-runtime";
import { describe, expect, it, vi } from "vitest";

import { executeWithPublicationRepair } from "../src/deliberation-turn.js";

describe("deliberation writing publication repair", () => {
  it("runs one fresh turn after a writing-only publication failure", async () => {
    const execute = vi.fn(async (instructions: string) => ({ instructions }));
    const record = vi
      .fn()
      .mockRejectedValueOnce(
        new DeliberationRuntimeError(
          "artifact_publication_failed",
          "writing_publication_blocked",
          "blocked",
        ),
      )
      .mockResolvedValueOnce("published");

    const result = await executeWithPublicationRepair({
      instructions: "Review the proposal.",
      execute,
      record,
    });

    expect(result.recorded).toBe("published");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]).toContain("previous independent draft");
  });

  it("does not retry a non-writing contract failure", async () => {
    const execute = vi.fn(async (instructions: string) => ({ instructions }));
    const failure = new DeliberationRuntimeError(
      "context_evidence_invalid",
      "managed_run_event_missing",
      "missing evidence",
    );

    await expect(
      executeWithPublicationRepair({
        instructions: "Review the proposal.",
        execute,
        record: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
