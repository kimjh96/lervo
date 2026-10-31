import { mkdtempSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan, inspectEventWriterCoordinate } from "@lervo/project";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Keeps upgrade applies off the developer host's real background-resident admission. */
const isolatedAdmission = {
  knowledgeCycleAdmission: {
    directory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-admission-")),
  },
};

const ports = vi.hoisted(() => ({
  inspect: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../src/knowledge-host-service.js", () => ({
  inspectHostResidentService: ports.inspect,
  applyHostResidentService: ports.apply,
}));

const { runCli } = await import("../src/main.js");

const roots: string[] = [];
afterEach(async () => {
  ports.inspect.mockReset();
  ports.apply.mockReset();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const hostService = {
  disposition: "safe_apply",
  reason: "host_service_missing",
  manager: "launchd",
  serviceIdentity: "com.lervo.knowledge.host",
  action: "install",
  definitionHash: `sha256:${"a".repeat(64)}`,
  installedDefinitionHash: null,
  configAction: "create",
  configHash: `sha256:${"b".repeat(64)}`,
  servedRepositoryCount: 2,
  nodeServedRepositoryCount: 1,
  unmanagedResidentRunning: false,
  blockers: [],
};

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-writer-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_upgrade_event_writer" }));
  return root;
}

describe("lervo upgrade event writer and host service stages", () => {
  it("activates schema 8 with a backup and installs the host resident service in one apply", async () => {
    const root = await repository();
    ports.inspect.mockResolvedValue(hostService);
    ports.apply.mockResolvedValue({ change: "installed", configCreated: true });
    const output: string[] = [];
    const errors: string[] = [];
    await runCli(["upgrade", "--json"], io(root, output, errors));
    const plan = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      applicableStages: string[];
      stages: Record<string, { disposition: string; reason: string }>;
      policy: { stageDependencies: Record<string, unknown> };
    };
    expect(plan.stages.eventWriter).toMatchObject({
      disposition: "safe_apply",
      currentSchemaVersion: 1,
      targetSchemaVersion: 8,
      authority: "local",
    });
    expect(plan.stages.hostService).toMatchObject({ disposition: "safe_apply" });
    expect(plan.applicableStages).toEqual(expect.arrayContaining(["event_writer", "host_service"]));
    expect(plan.policy.stageDependencies.event_writer).toEqual([
      { stage: "terminal_integration", requires: "applied_first" },
      { stage: "node", requires: "applied_first" },
    ]);

    await runCli(
      ["upgrade", "--apply", "--approval", plan.planId, "--json"],
      io(root, output, errors),
      isolatedAdmission,
    );
    const receipt = JSON.parse(output.join("")) as { appliedStages: string[] };
    expect(receipt.appliedStages).toEqual(expect.arrayContaining(["event_writer", "host_service"]));
    expect((await inspectEventWriterCoordinate(root)).coordinate.selectedEventSchemaVersion).toBe(
      8,
    );
    await stat(resolve(root, ".lervo/data/event-writer-backups/schema-8/backup.json"));
    expect(ports.apply).toHaveBeenCalledWith(hostService);
  }, 30_000);

  it("reports a host service blocker without blocking the event writer", async () => {
    const root = await repository();
    ports.inspect.mockResolvedValue({
      ...hostService,
      disposition: "blocked",
      reason: "service_manager_unavailable",
      action: "none",
      blockers: [{ code: "service_manager_unavailable", message: "Enable systemd." }],
    });
    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade"], io(root, output, errors))).toBe(1);
    const text = output.join("");
    expect(text).toContain("event writer: safe_apply (event_writer_activation_ready)");
    expect(text).toContain("host resident service: blocked (service_manager_unavailable)");
    expect(text).toContain("blocker [service_manager_unavailable]");
  });
});
