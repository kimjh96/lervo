import { describe, expect, it } from "vitest";

import { inspectProviderExecutable } from "../src/index.js";

describe("provider runtime inspection", () => {
  it("reads a bounded version without inheriting credentials", async () => {
    const key = "LERVO_PROVIDER_PROBE_SECRET";
    const previous = process.env[key];
    process.env[key] = "must-not-reach-child";
    let result;
    try {
      result = await inspectProviderExecutable({
        provider: "codex",
        executable: process.execPath,
        arguments: [
          "-e",
          `console.log(process.env.${key}===undefined?'fixture-provider 1.2.3':'environment-leaked')`,
        ],
        source: "configured",
      });
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }

    expect(result).toEqual({
      provider: "codex",
      status: "available",
      source: "configured",
      version: "fixture-provider 1.2.3",
      reasonCode: "ready",
    });
  });

  it("rejects output beyond the probe evidence limit", async () => {
    await expect(inspectProviderExecutable({
      provider: "claude",
      executable: process.execPath,
      arguments: [
        "-e",
        "process.stdout.write('fixture-provider 1.2.3\\n'+'x'.repeat(17*1024))",
      ],
      source: "configured",
    })).resolves.toMatchObject({
      status: "unknown",
      version: null,
      reasonCode: "probe_failed",
    });
  });

  it("distinguishes a missing executable from a working runtime", async () => {
    await expect(inspectProviderExecutable({
      provider: "codex",
      executable: "lervo-provider-that-does-not-exist",
      source: "configured",
    })).resolves.toMatchObject({
      status: "unavailable",
      version: null,
      reasonCode: "executable_not_found",
    });
  });
});
