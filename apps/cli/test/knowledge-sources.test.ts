import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { collectExecutionEventSources } from "@lervo/repository-knowledge";
import { expect, it } from "vitest";

import { collectLocalKnowledgeSources } from "../src/knowledge-sources.js";

it("collects complete SQLite execution originals beyond the legacy corpus without writing new events", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-paged-evidence-"));
  try {
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_page_cli_0001" }));
    const storage = await openProjectStorage(root);
    let head;
    try {
      storage.events.transact((transaction) => {
        for (let index = 0; index < 4_100; index += 1)
          transaction.append({
            eventId: `evt_page_cli_${String(index).padStart(8, "0")}`,
            projectId: storage.manifest.projectId,
            runId: "run_page_cli_0001",
            sessionId: "ses_page_cli_0001",
            type: "context.selected",
            schemaVersion: 1,
            actor: { kind: "system" },
            occurredAt: "2026-09-28T00:00:00.000Z",
            policyVersion: `sha256:${"b".repeat(64)}`,
            payload: { documentId: "a".repeat(4_000) },
          });
      });
      head = storage.events.latest();
      expect(() => collectExecutionEventSources({ events: storage.events })).toThrowError(
        expect.objectContaining({ code: "knowledge_evidence_source_invalid" }),
      );
    } finally {
      await storage.close();
    }
    const sources = await collectLocalKnowledgeSources(root);
    expect(sources).toHaveLength(4_100);
    expect(sources[0]!.path).toBe("@event/evt_page_cli_00000000");
    expect(JSON.parse(sources.at(-1)!.content)).toEqual(head);
    const reopened = await openProjectStorage(root);
    try {
      expect(reopened.events.latest()).toEqual(head);
      expect(reopened.events.verifyIntegrity().eventCount).toBe(4_100);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
