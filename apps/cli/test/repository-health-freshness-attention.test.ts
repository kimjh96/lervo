import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { documentFreshnessAttentionSources } from "@lervo/repository-knowledge-runtime";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import { healthFreshnessCandidate } from "./repository-health-freshness-fixture.js";
import { healthNow } from "./repository-health-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([17, 300])(
  "classifies all %i freshness candidates before the report cap",
  async (count) => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-health-candidates-"));
    roots.push(root);
    for (let i = 0; i < count; i++) {
      const candidateId = `kfresh_${i.toString(16).padStart(24, "0")}`;
      const candidate = healthFreshnessCandidate({
        candidateId,
        updatedAt: new Date(healthNow.getTime() - i * 1000).toISOString(),
      });
      if (i < count - 1)
        for (const hunk of candidate.hunks) {
          hunk.ownership = "lervo_managed";
          hunk.authorityRequired = "none";
        }
      const directory = resolve(
        root,
        ".lervo/state/knowledge/freshness-candidates",
        candidateId.slice(7, 9),
      );
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, `${candidateId}.json`), JSON.stringify(candidate));
    }
    const documentFreshness = await documentFreshnessAttentionSources(root, healthNow);
    expect(documentFreshness.awaiting).toHaveLength(count);
    const report = createOperatingAttentionReport({
      projectId: "prj_health",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "cached", issues: [] },
      documentFreshness,
      observedAt: healthNow,
    });
    expect(report.summary).toMatchObject({
      totalCount: count,
      userActionCount: 1,
      truncatedCount: Math.max(0, count - 256),
    });
    expect(report.items[0]).toMatchObject({
      candidateId: `kfresh_${(count - 1).toString(16).padStart(24, "0")}`,
      requiresUserAction: true,
    });
    expect(report.items[0]!.attribution!.inspectCommand).toContain(
      "lervo knowledge freshness review",
    );
  },
);
