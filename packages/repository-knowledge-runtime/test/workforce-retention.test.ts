import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  archiveConvergenceAssignment,
  listAssignments,
  createAssignment,
} from "@lervo/agent-workforce";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { canonicalJson, sha256, stableId } from "@lervo/repository-knowledge";
import { fixture } from "./fixture.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";

it(
  "archives exact terminal assignment bytes after durable evidence, preserving dependent projections",
  { timeout: 90_000 },
  async () => {
    const f = await fixture(true);
    try {
      let result;
      for (let i = 0; i < 6; i++) {
        result = await runAutonomousKnowledgeWorker({
          storage: f.storage,
          workerId: "retention",
          provider: "claude",
          executable: f.executable,
          admissionDirectory: f.admissionDirectory,
        });
        if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
      }
      expect(result).toMatchObject({ convergence: { lastVerifiedCurrency: expect.any(Object) } });
      const candidates = (await listAssignments(f.root)).filter(
        (item) => item.accessMode === "read_only",
      );
      const selected = candidates[0]!;
      const home = await resolveRepositoryCoordinationHome(f.root, { readOnly: true });
      const path = resolve(home.workforce, "assignments", `${selected.assignmentId}.json`);
      const bytes = await readFile(path);
      const terminal = f.events.get(
        stableId("evt", [selected.convergence!.obligationId, "terminal"], 32),
      )!;
      const input = {
        repositoryRoot: f.root,
        assignmentId: selected.assignmentId,
        expectedContentHash: sha256(bytes),
        terminalEventId: terminal.eventId,
        terminalEventHash: terminal.eventHash,
        events: f.events,
        artifacts: f.artifacts,
        archivedAt: new Date().toISOString(),
      };
      await expect(
        archiveConvergenceAssignment({
          ...input,
          recordEvent: () => {
            throw new Error("Canonical event unavailable");
          },
        }),
      ).rejects.toThrow("Canonical event unavailable");
      expect(await readFile(path)).toEqual(bytes);
      await archiveConvergenceAssignment({
        ...input,
        recordEvent: (event) => {
          f.events.append({
            eventId: stableId("evt", [selected.assignmentId, "archive"], 32),
            projectId: f.storage.manifest.projectId,
            runId: `run_${"a".repeat(32)}`,
            sessionId: `ses_${"a".repeat(32)}`,
            schemaVersion: 4,
            type: event.type,
            actor: { kind: "system" },
            occurredAt: event.occurredAt,
            policyVersion: sha256(canonicalJson(event.payload)),
            payload: event.payload,
          });
        },
      });
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      const archived = f.events.get(stableId("evt", [selected.assignmentId, "archive"], 32))!;
      expect(archived).toMatchObject({
        type: "assignment.convergence.archived",
        payload: {
          assignmentHash: sha256(bytes),
          archiveArtifactHash: sha256(bytes),
          terminalEventHash: terminal.eventHash,
        },
      });
      expect(await f.artifacts.get(`lervo-cas://sha256/${sha256(bytes).slice(7)}`)).toEqual(bytes);
      const retained = candidates[1]!;
      await createAssignment({
        repositoryRoot: f.root,
        taskType: "knowledge.retention.consumer",
        roleId: retained.roleId,
        acceptanceCriteria: ["Preserve the exact terminal dependency."],
        verificationSuiteIds: retained.verificationSuiteIds,
        dependencyIds: [retained.assignmentId],
        expectedPaths: ["docs/specs"],
      });
      const retainedBytes = await readFile(
        resolve(home.workforce, "assignments", `${retained.assignmentId}.json`),
      );
      await expect(
        archiveConvergenceAssignment({
          ...input,
          assignmentId: retained.assignmentId,
          expectedContentHash: sha256(retainedBytes),
          recordEvent: () => {
            throw new Error("Must not record");
          },
        }),
      ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
      expect(
        (await listAssignments(f.root)).some((item) => item.assignmentId === retained.assignmentId),
      ).toBe(true);
    } finally {
      await f.storage.close();
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);
