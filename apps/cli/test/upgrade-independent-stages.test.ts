import { mkdtempSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { activateLocalEventWriter } from "../src/event-writer-activation-stage.js";
import { collectEventReaderActivationEvidence } from "../src/event-reader-inventory.js";
import { runCli as runUnisolatedCli } from "../src/main.js";
import {
  applyTerminalIntegrationStage,
  planTerminalIntegrationStage,
} from "../src/terminal-integration-stage.js";
import { inspectTerminalRepositoryKnowledge } from "../src/terminal-knowledge-lifecycle-inspection.js";
import * as terminalRuntime from "../src/terminal-runtime.js";
import { loadTerminalHookLauncher } from "../src/terminal-runtime.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

/** Keeps upgrade applies off the developer host's real background-resident admission. */
const isolatedAdmission = {
  knowledgeCycleAdmission: {
    directory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-admission-")),
  },
};

const roots: string[] = [];
const lockedDirectories: string[] = [];
const runtimePath = ".lervo/generated/terminal-hooks/runtime-v2.mjs";

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of lockedDirectories.splice(0))
    await chmod(directory, 0o700).catch(() => undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function repositoryWithInstalledTerminalHooks(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-independent-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "argo-fixture"], io(root, [], []))).toBe(0);
  const install = await planTerminalIntegrationStage(root);
  expect(install.plan.status).toBe("ready");
  await applyTerminalIntegrationStage({
    repositoryRoot: root,
    prepared: install,
    now: new Date("2026-09-30T00:00:00Z"),
  });
  return root;
}

describe("lervo upgrade with a blocked stage", () => {
  it("regenerates the terminal runtime while knowledge stays blocked by invalid document metadata", async () => {
    const root = await repositoryWithInstalledTerminalHooks();
    await writeFile(resolve(root, runtimePath), "#!/usr/bin/env node\n// stale runtime\n");
    await mkdir(resolve(root, "v3"), { recursive: true });
    await mkdir(resolve(root, "v4"), { recursive: true });
    const invalidMetadata = ["---", "lervo:", "  document: invalid", "---"].join("\n");
    await writeFile(
      resolve(root, "v3/REQUIREMENTS.md"),
      `${invalidMetadata}\n# Requirements\n\nVersion three.\n`,
    );
    await writeFile(
      resolve(root, "v4/DESIGN.md"),
      `${invalidMetadata}\n# Design\n\nVersion four.\n`,
    );
    const requirements = await readFile(resolve(root, "v3/REQUIREMENTS.md"), "utf8");
    // ADR-0539: an installed CLI publishes the host hook runtime at startup; runCli skips bin.ts.
    vi.spyOn(terminalRuntime, "hostTerminalHookReaderCurrent").mockResolvedValue(true);

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors))).toBe(1);
    expect(errors).toEqual([]);
    const plan = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      status: string;
      applicableStages: string[];
      policy: { stageDependencies: Record<string, unknown> };
      stages: {
        terminalIntegration: { disposition: string; reason: string };
        knowledge: { disposition: string; blockers: Array<{ code: string; path?: string }> };
      };
    };
    expect(plan.status).toBe("blocked");
    expect(plan.applicableStages).toEqual(["terminal_integration"]);
    expect(plan.policy.stageDependencies.terminal_integration).toEqual([]);
    expect(plan.stages.terminalIntegration).toMatchObject({
      disposition: "safe_apply",
      reason: "generated_runtime_only",
    });
    expect(plan.stages.knowledge.disposition).toBe("blocked");
    expect(plan.stages.knowledge.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_document_metadata", path: "v3/REQUIREMENTS.md" }),
        expect.objectContaining({ code: "invalid_document_metadata", path: "v4/DESIGN.md" }),
      ]),
    );

    const humanOutput: string[] = [];
    expect(await runCli(["upgrade"], io(root, humanOutput, errors))).toBe(1);
    expect(humanOutput.join("")).toContain(
      "blocker [invalid_document_metadata] v3/REQUIREMENTS.md",
    );
    expect(humanOutput.join("")).toContain(
      "Independent stages can still apply (terminal_integration): re-run with --apply.",
    );

    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
    ).toBe(1);
    expect(errors).toEqual([]);
    const receipt = JSON.parse(output.join("")) as {
      status: string;
      appliedStages: string[];
      skippedStages: Array<{ stage: string; reason: string }>;
      knowledgeLint: unknown;
      pending: Array<{ stage: string; disposition: string; blockers: Array<{ code: string }> }>;
    };
    expect(receipt.status).toBe("blocked");
    // The event writer stage was deferred behind the hook runtime and applies after it.
    expect(receipt.appliedStages).toEqual(["terminal_integration", "event_writer"]);
    // ADR-0546: lint still reports the blocked knowledge state, and no stage waits on it.
    expect(receipt.knowledgeLint).toMatchObject({ issueCount: expect.any(Number) });
    expect(receipt.skippedStages).toEqual([]);
    expect(receipt.pending).toContainEqual(
      expect.objectContaining({
        stage: "knowledge",
        disposition: "blocked",
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_document_metadata" }),
        ]),
      }),
    );
    expect(await readFile(resolve(root, runtimePath), "utf8")).toBe(
      await loadTerminalHookLauncher(),
    );
    expect(await readFile(resolve(root, "v3/REQUIREMENTS.md"), "utf8")).toBe(requirements);

    output.length = 0;
    expect(await runCli(["upgrade", "--json"], io(root, output, errors))).toBe(1);
    const after = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      applicableStages: string[];
      stages: { terminalIntegration: { disposition: string } };
    };
    expect(after.stages.terminalIntegration.disposition).toBe("current");
    expect(after.applicableStages).toEqual([]);
    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
    ).toBe(1);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.join(""))).toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("no independent stage to apply") },
    });
  }, 30_000);

  it("keeps the knowledge stage unblocked by application content and unmatched titles", async () => {
    const root = await repositoryWithInstalledTerminalHooks();
    const data = "apps/web/app/[lang]/docs/_data";
    await mkdir(resolve(root, `${data}/writing-guide`), { recursive: true });
    await mkdir(resolve(root, "misc"), { recursive: true });
    await writeFile(resolve(root, "apps/web/package.json"), '{ "name": "web" }\n');
    await writeFile(
      resolve(root, "apps/web/app/[lang]/docs/page.tsx"),
      'export const guides = join(process.cwd(), "app", "[lang]", "docs", "_data");\n',
    );
    for (const path of [
      `${data}/writing-guide.md`,
      `${data}/writing-guide/korean.md`,
      `${data}/sentences.md`,
      `${data}/vocabulary.md`,
    ])
      await writeFile(resolve(root, path), "# Guide\n\nRendered by the web app.\n");
    await writeFile(resolve(root, "misc/purple-zebra.md"), "# Purple zebra quorum\n\nNotes.\n");

    const output: string[] = [];
    const errors: string[] = [];
    await runCli(["upgrade", "--json"], io(root, output, errors));
    expect(errors).toEqual([]);
    const plan = JSON.parse(output.splice(0).join("")) as {
      stages: {
        knowledge: {
          disposition: string;
          blockers: unknown[];
          deferredDocuments?: Array<{ path: string; reason: string; subject: string }>;
        };
      };
    };
    expect(plan.stages.knowledge.disposition).not.toBe("blocked");
    expect(plan.stages.knowledge.blockers).toEqual([]);
    expect(plan.stages.knowledge.deferredDocuments).toEqual([
      expect.objectContaining({
        path: "misc/purple-zebra.md",
        reason: "semantic_classification_pending",
        subject: "document",
      }),
    ]);

    const humanOutput: string[] = [];
    await runCli(["upgrade"], io(root, humanOutput, errors));
    // ADR-0540: text lists each deferral by its resolution; no delegation admits a provider here.
    expect(humanOutput.join("")).toContain("deferred [provider_unavailable] misc/purple-zebra.md");
    expect(humanOutput.join("")).not.toContain(data);

    const knowledge = await inspectTerminalRepositoryKnowledge({
      root,
      repositoryRevision: "unrecorded",
      supplementalSources: [],
    });
    expect(knowledge.advisories).toContainEqual({
      code: "document_route_classification_deferred",
      detail: "misc/purple-zebra.md: semantic_classification_pending (provider_unavailable)",
      command: expect.stringContaining("lervo migrate knowledge --provider"),
    });
    expect(knowledge.issues.map((issue) => issue.code)).not.toContain("repository_layout_blocked");
  }, 30_000);
});

/** A backup laid out as `createEventWriterActivationBackup` writes it, `daysAgo` days old. */
async function eventWriterBackup(root: string, version: number, daysAgo: number): Promise<string> {
  const directory = resolve(root, ".lervo/data/event-writer-backups", `schema-${version}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "events.sqlite"),
    Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(64)]),
  );
  await writeFile(resolve(directory, "event-contract.json"), "{}\n");
  await writeFile(
    resolve(directory, "backup.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "event_writer_activation_backup",
      createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      planId: `ewa_${version}`,
      targetEventSchemaVersion: version,
      eventDatabase: "copied",
      coordinate: "copied",
    }),
  );
  return directory;
}

describe("lervo upgrade when event writer backup retention fails (ADR-0651)", () => {
  it("applies every other stage and holds the failed removal as Lervo debt", async () => {
    const root = await repositoryWithInstalledTerminalHooks();
    await writeFile(resolve(root, runtimePath), "#!/usr/bin/env node\n// stale runtime\n");
    vi.spyOn(terminalRuntime, "hostTerminalHookReaderCurrent").mockResolvedValue(true);
    // The activation writes the rollback point, schema-16, and selects 16.
    expect(
      await activateLocalEventWriter(root, {
        collectEvidence: collectEventReaderActivationEvidence,
        hookReader: async () => "current",
        now: () => new Date(),
      }),
    ).toMatchObject({ status: "activated" });
    // schema-8 superseded schema-5 30 days ago; schema-16 superseded schema-8 just now.
    const superseded = await eventWriterBackup(root, 5, 60);
    await eventWriterBackup(root, 8, 30);
    // Without write permission inside it, the rename aside succeeds and the removal fails.
    await chmod(superseded, 0o500);
    lockedDirectories.push(superseded);

    const output: string[] = [];
    const errors: string[] = [];
    await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission);
    expect(errors).toEqual([]);
    const receipt = JSON.parse(output.join("")) as {
      status: string;
      appliedStages: string[];
      skippedStages: Array<{ stage: string; reason: string }>;
      eventWriterBackupRetention: { removed: string[]; failure: { code: string; name: string } };
      pending: Array<{ stage: string; disposition: string; reason: string }>;
    };
    expect(receipt.appliedStages).toContain("terminal_integration");
    expect(receipt.appliedStages).not.toContain("event_writer_backup_retention");
    expect(receipt.skippedStages).toContainEqual({
      stage: "event_writer_backup_retention",
      reason: "event_writer_backup_retention_failed",
    });
    expect(receipt.eventWriterBackupRetention).toMatchObject({
      removed: [],
      failure: { code: "event_writer_backup_retention_failed" },
    });
    expect(receipt.pending).toContainEqual(
      expect.objectContaining({
        stage: "event_writer_backup_retention",
        disposition: "lervo_debt",
        reason: "event_writer_backup_retention_failed",
      }),
    );
    expect(receipt.status).not.toBe("ready");
    const leftovers = (await readdir(resolve(root, ".lervo/data/event-writer-backups"))).filter(
      (name) => name.startsWith(".retired-"),
    );
    expect(leftovers).toHaveLength(1);
    const leftover = resolve(root, ".lervo/data/event-writer-backups", leftovers[0]!);
    lockedDirectories.push(leftover);

    // Once the removal can proceed, the next upgrade finishes the leftover, and with no grace
    // period also schema-8, which schema-16 superseded.
    await chmod(leftover, 0o700);
    output.length = 0;
    await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission);
    expect(JSON.parse(output.join(""))).toMatchObject({
      appliedStages: expect.arrayContaining(["event_writer_backup_retention"]),
      eventWriterBackupRetention: { removed: [leftovers[0], "schema-8"] },
    });
  }, 60_000);
});
