import { dirname } from "node:path";
import * as detection from "../src/provider-cli-detection.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";
import { readFile, writeFile, rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { fixture } from "./fixture.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("waits through the real resolver and host, then readmits the waiting stage after executable replacement", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  vi.spyOn(detection, "defaultProviderCliDetectionPorts").mockReturnValue({
    home: f.directory,
    shell: process.execPath,
    prefixes: [],
    command: async (executable, args, timeoutMs, environment) => {
      if (args[0] === "-lc")
        return { status: "completed", stdout: `\0${dirname(process.execPath)}:/usr/bin:/bin\0` };
      return runProviderCliCommand(executable, args, timeoutMs, environment);
    },
  });
  const original = await readFile(f.executable, "utf8");
  await writeFile(
    f.executable,
    original.replace("stop_reason:'end_turn',num_turns:1", "stop_reason:'tool_use',num_turns:2"),
  );
  const run = () =>
    runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "admission-regression",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      maximumStages: 1,
      liveWorkPending: async () => false,
    });
  expect(await run()).toMatchObject({
    status: "processed",
    convergence: { state: "waiting_authority", reason: "provider_not_admitted" },
  });
  expect(await run()).toMatchObject({
    status: "processed",
    convergence: { state: "waiting_authority", reason: "provider_not_admitted" },
  });
  await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(f.executable, original);
  const result = await run();
  expect(result.status).toBe("processed");
  if (result.status === "processed")
    expect(result.convergence.reason).not.toBe("provider_not_admitted");
  expect(f.events.list({ limit: 1000, types: ["provider.cli.admitted"] })).toHaveLength(1);
  expect(await readFile(f.log, "utf8")).toContain("request");
});
