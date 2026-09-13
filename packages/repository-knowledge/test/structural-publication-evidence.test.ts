import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKnowledgeMigrationPlanForScan,
  scanRepositoryKnowledge,
  type KnowledgeMigrationPlan,
  type RepositorySupplementalSource,
} from "../src/index.js";
import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";

const roots: string[] = [];
const projectId = "prj_publicationfixture";
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "structural-publication-evidence-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await writeFile(resolve(root, "README.md"), "# Stable repository\n\nPortable source.\n");
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function publications(plan: KnowledgeMigrationPlan) {
  return plan.operations
    .filter((operation) => operation.mediaType === "text/markdown")
    .map(({ path, desiredHash, content }) => ({ path, desiredHash, content }));
}

function evidence(
  kind: "execution_event" | "verification_result",
  id: string,
): RepositorySupplementalSource {
  const event = kind === "execution_event";
  return {
    path: `@${event ? "event" : "verification"}/${id}`,
    kind,
    classification: "ordinary",
    content: JSON.stringify({ fixture: id }) + "\n",
    origin: event ? "execution_event_store" : "verification_event_cas",
    unitKind: event ? "event" : "verification",
    locator: `${event ? "event" : "verification"}:${id}`,
    title: "Local fixture evidence",
    adapter: "fixture-evidence-v1",
  };
}

describe("structural publication evidence boundary", () => {
  it("preserves publication bytes across unequal host histories while retaining full evidence units", async () => {
    const root = await fixture();
    const scans = [];
    const plans = [];
    for (const count of [0, 1, 7]) {
      const supplementalSources = Array.from({ length: count }, (_, index) =>
        evidence(index % 2 === 0 ? "execution_event" : "verification_result", `fixture${index}`),
      );
      const scan = await scanRepositoryKnowledge({
        repositoryRoot: root,
        projectId,
        policy: defaultRepositoryKnowledgePolicy,
        supplementalSources,
        observeRevision: async () => ({ status: "observed", content: `${"a".repeat(40)}\n` }),
      });
      expect(
        scan.units.filter((unit) => unit.unitKind === "event" || unit.unitKind === "verification"),
      ).toHaveLength(count);
      scans.push(scan);
      plans.push(await createKnowledgeMigrationPlanForScan({ repositoryRoot: root, scan }));
    }
    expect(new Set(scans.map((scan) => scan.snapshotId)).size).toBe(3);
    expect(publications(plans[1]!)).toEqual(publications(plans[0]!));
    expect(publications(plans[2]!)).toEqual(publications(plans[0]!));
    const index = publications(plans[2]!).find(
      (item) => item.path === "docs/knowledge/index.md",
    )!.content;
    expect(index).not.toMatch(/- (execution_event|verification_result|revision_metadata):/u);
  });

  it("ignores revision availability in publication counts but still binds ordinary source changes", async () => {
    const root = await fixture();
    const plans = [];
    for (const observed of [false, true]) {
      const scan = await scanRepositoryKnowledge({
        repositoryRoot: root,
        projectId,
        policy: defaultRepositoryKnowledgePolicy,
        observeRevision: async () =>
          observed
            ? { status: "observed", content: `${"b".repeat(40)}\n` }
            : { status: "unavailable", reason: "git_head_unavailable" },
      });
      plans.push(await createKnowledgeMigrationPlanForScan({ repositoryRoot: root, scan }));
    }
    expect(publications(plans[1]!)).toEqual(publications(plans[0]!));
    await writeFile(resolve(root, "README.md"), "# Changed source\n\nDifferent canonical bytes.\n");
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId,
      policy: defaultRepositoryKnowledgePolicy,
    });
    const changed = await createKnowledgeMigrationPlanForScan({ repositoryRoot: root, scan });
    expect(publications(changed)).not.toEqual(publications(plans[0]!));
  });
});
