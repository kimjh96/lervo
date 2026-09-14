import { delimiter, dirname } from "node:path";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProviderProcessEnvironment,
  inspectProviderExecutable,
  inspectRuntimeExecutable,
} from "../src/index.js";

describe("provider runtime inspection", () => {
  it("prepends the current Node runtime to a provider process environment", () => {
    const environment = createProviderProcessEnvironment(
      { PATH: ["/usr/bin", dirname(process.execPath), "/bin"].join(delimiter), OMITTED: undefined },
      process.execPath,
    );

    expect(environment.PATH?.split(delimiter)).toEqual([
      dirname(process.execPath),
      "/usr/bin",
      "/bin",
    ]);
    expect(environment).not.toHaveProperty("OMITTED");
  });

  it("preserves the host path key spelling without emitting a duplicate", () => {
    const environment = createProviderProcessEnvironment(
      { Path: "/system/bin", PATH: "/ignored/duplicate", TOKEN: "preserved" },
      "/runtime/bin/node",
    );

    expect(environment).toEqual({
      Path: ["/runtime/bin", "/system/bin"].join(delimiter),
      TOKEN: "preserved",
    });
  });

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

  it.skipIf(process.platform === "win32")(
    "probes an env-node launcher under a minimal service path",
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "lervo-provider-probe-"));
      const executable = resolve(directory, "provider");
      const previous = process.env.PATH;
      try {
        await writeFile(executable, "#!/usr/bin/env node\nconsole.log('fixture-provider 1.2.3')\n");
        await chmod(executable, 0o700);
        process.env.PATH = "";
        await expect(
          inspectProviderExecutable({ provider: "codex", executable, source: "configured" }),
        ).resolves.toMatchObject({ status: "available", version: "fixture-provider 1.2.3" });
      } finally {
        if (previous === undefined) delete process.env.PATH;
        else process.env.PATH = previous;
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects output beyond the probe evidence limit", async () => {
    await expect(
      inspectProviderExecutable({
        provider: "claude",
        executable: process.execPath,
        arguments: ["-e", "process.stdout.write('fixture-provider 1.2.3\\n'+'x'.repeat(17*1024))"],
        source: "configured",
      }),
    ).resolves.toMatchObject({
      status: "unknown",
      version: null,
      reasonCode: "probe_failed",
    });
  });

  it("distinguishes a permission-denied executable from a missing one", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-permission-"));
    try {
      const executable = resolve(root, "provider");
      await writeFile(executable, "#!/bin/sh\necho 1.0.0\n", { mode: 0o000 });
      await expect(
        inspectProviderExecutable({ provider: "codex", executable, source: "configured" }),
      ).resolves.toMatchObject({
        status: "unavailable",
        version: null,
        reasonCode: "executable_permission_denied",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("distinguishes a missing executable from a working runtime", async () => {
    await expect(
      inspectProviderExecutable({
        provider: "codex",
        executable: "lervo-provider-that-does-not-exist",
        source: "configured",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      version: null,
      reasonCode: "executable_not_found",
    });
  });
});

describe("generic executable inspection", () => {
  it("observes a tool without attributing it to a provider", async () => {
    const result = await inspectRuntimeExecutable({
      executable: process.execPath,
      source: "configured",
    });
    expect(result.status).toBe("available");
    expect(result.version).toBe(process.version);
    expect(result).not.toHaveProperty("provider");
  });
  it("bounds an unresponsive executable", async () => {
    await expect(
      inspectRuntimeExecutable({
        executable: process.execPath,
        arguments: ["-e", "setInterval(() => {}, 1000)"],
        source: "configured",
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ status: "unknown", reasonCode: "probe_timed_out", version: null });
  });
});
