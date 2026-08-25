import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workstream CLI", () => {
  it("starts a first workstream without requiring a legacy filename", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-workstream-start-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);
    const draft = JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Fresh repository task",
      objective: "Preserve agent continuation state.",
      nextActions: ["Verify provider injection."],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [
        {
          decisionId: "wdec_0123456789abcdef",
          question: "Which rollout mode should be used?",
          choices: [
            { choiceId: "staged", label: "Staged", consequence: "Limits initial exposure." },
            {
              choiceId: "direct",
              label: "Direct",
              consequence: "Publishes to every node immediately.",
            },
          ],
          recommendedChoiceId: "staged",
          blocking: true,
        },
      ],
      pendingApprovals: [
        {
          approvalId: "wapr_0123456789abcdef",
          kind: "external_action",
          summary: "Publish the selected rollout configuration.",
          bindingHash: `sha256:${"a".repeat(64)}`,
          blocking: true,
        },
      ],
      updatedAt: "2026-08-24T02:30:00.000Z",
    });
    const output: string[] = [];
    expect(
      await runCli(["workstream", "start", "--stdin", "--json"], {
        ...quiet,
        stdin: async () => draft,
        stdout: (message) => output.push(message),
      }),
    ).toBe(0);
    const plan = JSON.parse(output.join("")) as { planId: string };
    expect(
      await runCli(["workstream", "start", "--stdin", "--apply", plan.planId], {
        ...quiet,
        stdin: async () => draft,
      }),
    ).toBe(0);
    const current: string[] = [];
    expect(
      await runCli(["workstream", "current", "--json"], {
        ...quiet,
        stdout: (message) => current.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(current.join(""))).toMatchObject({
      workstream: {
        title: "Fresh repository task",
        revision: 1,
        origin: { kind: "created" },
        pendingDecisions: [{ decisionId: "wdec_0123456789abcdef", recommendedChoiceId: "staged" }],
        pendingApprovals: [{ approvalId: "wapr_0123456789abcdef", kind: "external_action" }],
      },
    });
    await rm(resolve(root, ".lervo/state"), { recursive: true, force: true });
    const rebuilt: string[] = [];
    expect(
      await runCli(["workstream", "current", "--json"], {
        ...quiet,
        stdout: (message) => rebuilt.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(rebuilt.join(""))).toMatchObject({
      workstream: { title: "Fresh repository task", revision: 1 },
    });
    expect(
      await readFile(resolve(root, ".lervo/state/workstreams/current.json"), "utf8"),
    ).toContain("Fresh repository task");
  });

  it("migrates HANDOFF through migrate knowledge, records artifacts, and supports planned updates", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-workstream-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);
    await writeFile(
      resolve(root, "HANDOFF.md"),
      "# CLI handoff\n\n## Current objective\n\nComplete workstream migration.\n\n## Next actions\n\n- Verify the event.\n",
    );
    await writeFile(
      resolve(root, "AGENTS.md"),
      "# Agents\n\nRead `HANDOFF.md` before continuing.\n",
    );

    const planOutput: string[] = [];
    expect(
      await runCli(["migrate", "knowledge", "--json"], {
        ...quiet,
        stdout: (message) => planOutput.push(message),
      }),
    ).toBe(0);
    const plan = JSON.parse(planOutput.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      planKind: string;
    };
    expect(plan.planKind).toBe("continuation_workstream");
    const applyOutput: string[] = [];
    expect(
      await runCli(
        [
          "migrate",
          "knowledge",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        { ...quiet, stdout: (message) => applyOutput.push(message) },
      ),
    ).toBe(0);
    expect(JSON.parse(applyOutput.join(""))).toMatchObject({
      operation: "legacy_continuation_migration",
      revision: 1,
    });

    const currentOutput: string[] = [];
    expect(
      await runCli(["workstream", "current", "--json"], {
        ...quiet,
        stdout: (message) => currentOutput.push(message),
      }),
    ).toBe(0);
    const current = JSON.parse(currentOutput.join("")) as { workstream: Record<string, unknown> };
    expect(current.workstream).toMatchObject({
      title: "CLI handoff",
      objective: "Complete workstream migration.",
      revision: 1,
    });
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(
      "lervo workstream current",
    );

    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find((item) => item.type === "workstream.snapshot.recorded");
      expect(event).toMatchObject({
        payload: { changeKind: "legacy_continuation_migration", revision: 1 },
      });
      expect(JSON.stringify(event)).not.toContain("Complete workstream migration");
      expect(
        await storage.artifacts.has(
          `lervo-cas://sha256/${String(event!.payload.snapshotContentHash).slice("sha256:".length)}`,
        ),
      ).toBe(true);
    } finally {
      await storage.close();
    }

    const desired = {
      ...current.workstream,
      revision: 2,
      status: "completed",
      nextActions: [],
      updatedAt: "2026-08-24T03:00:00.000Z",
    };
    const input = JSON.stringify(desired);
    const updatePlanOutput: string[] = [];
    expect(
      await runCli(["workstream", "update", "--stdin", "--json"], {
        ...quiet,
        stdin: async () => input,
        stdout: (message) => updatePlanOutput.push(message),
      }),
    ).toBe(0);
    const updatePlan = JSON.parse(updatePlanOutput.join("")) as { planId: string };
    expect(
      await runCli(["workstream", "update", "--stdin", "--apply", updatePlan.planId], {
        ...quiet,
        stdin: async () => input,
      }),
    ).toBe(0);
    const finalOutput: string[] = [];
    expect(
      await runCli(["workstream", "current", "--json"], {
        ...quiet,
        stdout: (message) => finalOutput.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(finalOutput.join(""))).toMatchObject({
      workstream: { revision: 2, status: "completed" },
    });
  });
});
