import * as workforce from "@lervo/agent-workforce";
import { operatingContractHash } from "@lervo/work-controller";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readWorkspace } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { observeUnstartedSupervisionWorkspace } from "../src/supervision-unstarted-workspace.js";
import { currentSupervisionWorkspaces } from "../src/supervision-workspace-generations.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { recordPreparedWorkspaceFixture } from "./supervision-prepared-workspace.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  "unrecorded",
  "live_lease",
  "changed_checkout",
  "missing_receipt",
  "changed_head",
  "concurrent_unrelated",
])(
  "retains only an expired unchanged workspace with no admitted dispatch: %s",
  async (condition) => {
    const f = await dispatchFixture(roots, true, undefined, "developer", [
      "dispatch",
      "execute_as_owner",
    ]);
    if (condition !== "missing_receipt") await recordPreparedWorkspaceFixture(f);
    const storage = await openProjectStorage(f.root);
    try {
      const workspace = (await readWorkspace(f.root, f.provision.workspace.workspaceId))!.workspace;
      const now =
        condition === "live_lease"
          ? f.ports.now
          : () => new Date(Date.parse(f.assignment.lease!.expiresAt) + 1).toISOString();
      const input = {
        repositoryRoot: f.root,
        binding: f.binding,
        assignment: f.assignment,
        workspace,
        storage,
        now,
      };
      if (condition === "changed_checkout")
        await writeFile(resolve(workspace.ownerWorkspacePath!, "user-owned.txt"), "retain me\n");
      // A concurrent event bound to this assignment invalidates the proof; a running worker's
      // unrelated events of another generation do not.
      if (condition === "changed_head" || condition === "concurrent_unrelated") {
        const read = workforce.readWorkspace;
        vi.spyOn(workforce, "readWorkspace").mockImplementation(async (...args) => {
          // The event lands during the final checkout re-read, after the head was captured.
          storage.events.append({
            eventId: "evt_workspace_inspection_race",
            projectId: storage.manifest.projectId,
            // The owner journal run is relevant to every retained generation.
            runId:
              condition === "changed_head"
                ? `run_${operatingContractHash({ supervisionId: f.binding.supervisionId }).slice(7, 39)}`
                : "run_workspace_inspection_race",
            sessionId: "ses_workspace_inspection_race",
            schemaVersion: 1,
            type: "run.requested",
            occurredAt: now(),
            actor: { kind: "system" },
            policyVersion: f.binding.mandateHash,
            payload: {},
          });
          vi.mocked(workforce.readWorkspace).mockRestore();
          return read(...args);
        });
      }
      const retained = await observeUnstartedSupervisionWorkspace(input);
      if (condition === "unrecorded") {
        expect(retained).toMatchObject({
          workspaceId: workspace.workspaceId,
          assignmentId: f.assignment.assignmentId,
        });
        expect(await observeUnstartedSupervisionWorkspace(input)).toEqual(retained);
        storage.events.append({
          eventId: "evt_unrelated_workspace_observation",
          projectId: storage.manifest.projectId,
          runId: "run_unrelated_workspace_observation",
          sessionId: "ses_unrelated_workspace_observation",
          schemaVersion: 1,
          type: "run.requested",
          occurredAt: now(),
          actor: { kind: "system" },
          policyVersion: f.binding.mandateHash,
          payload: {},
        });
        expect(await observeUnstartedSupervisionWorkspace(input)).toEqual(retained);
        const successor = {
          ...f.assignment,
          lease: { ...f.assignment.lease!, generation: f.assignment.lease!.generation + 1 },
        };
        expect(await currentSupervisionWorkspaces(f.root, successor, f.binding, storage)).toEqual(
          [],
        );
      } else if (condition === "concurrent_unrelated")
        expect(retained).toMatchObject({ workspaceId: workspace.workspaceId });
      else expect(retained).toBeNull();
      expect((await readWorkspace(f.root, workspace.workspaceId))!.workspace).toEqual(workspace);
    } finally {
      await storage.close();
    }
  },
  30000,
);
