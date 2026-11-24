import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  documentFreshnessPolicy,
  loadRepositoryKnowledgePolicy,
  refreshRelationWeb,
} from "@lervo/repository-knowledge";

import { revertFreshnessCandidate } from "../src/freshness-revert.js";
import { applyReverseHeaderEdits } from "../src/freshness-reverse-headers.js";
import { listFreshnessCandidates } from "../src/freshness-state-store.js";
import { freshnessFixture, type FreshnessFixture } from "./freshness-fixture.js";

const fixtures: FreshnessFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const BODY =
  "\n## Decision\n\n" + "The decision holds on every host for every repository.\n".repeat(6);
const BASE = "docs/specs/decisions/0001-base.md";
const BASE_CONTENT = `# ADR-0001: Base\n\nStatus: \`accepted\`\nDecision date: 2026-11-01\n${BODY}`;
const AMEND = "docs/specs/decisions/0002-amend.md";
const AMEND_CONTENT = `# ADR-0002: Amend\n\nStatus: \`accepted\`\nAmends: [ADR-0001](0001-base.md), [ADR-0003](../../other/0003-outside.md)\n${BODY}`;
const OUTSIDE = "docs/other/0003-outside.md";

async function setup() {
  const f = await freshnessFixture();
  fixtures.push(f);
  await f.write(BASE, BASE_CONTENT);
  await f.write(AMEND, AMEND_CONTENT);
  await f.write(OUTSIDE, `# ADR-0003: Outside\n\nStatus: \`accepted\`\n${BODY}`);
  await f.commit("docs: decisions");
  const policy = documentFreshnessPolicy(await loadRepositoryKnowledgePolicy(f.root));
  const run = async (now = new Date()) => {
    expect(await refreshRelationWeb(f.root, { commands: [], now })).toMatchObject({
      status: "current",
    });
    return applyReverseHeaderEdits({ context: { storage: f.storage, now: () => now }, policy });
  };
  return { f, run };
}

describe("reverse header lines through the freshness apply path (ADR-0631)", () => {
  it(
    "inserts the missing line inside the canonical roots, commits it, and settles once",
    { timeout: 120_000 },
    async () => {
      const { f, run } = await setup();
      expect(await run()).toEqual({ appliedCount: 1, remaining: false });
      expect(await f.read(BASE)).toBe(
        `# ADR-0001: Base\n\nStatus: \`accepted\`\nDecision date: 2026-11-01\nAmended by: [ADR-0002](0002-amend.md)\n${BODY}`,
      );
      // The record outside the delegation's canonical roots is never written.
      expect(await f.read(OUTSIDE)).toBe(`# ADR-0003: Outside\n\nStatus: \`accepted\`\n${BODY}`);
      const log = await f.git(["log", "-1", "--format=%s%n%b"]);
      expect(log).toContain("docs: add reverse header lines to ADR-0001");
      expect(log).toContain("Lervo-Freshness-Cross-Check: not_required");
      expect(log).toContain("Lervo-Freshness-Reason: reverse_header");
      expect(await f.git(["status", "--porcelain", "--", "docs"])).toBe("");
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({
        documentPath: BASE,
        state: "applied",
        tokensObserved: 0,
        mechanical: { kind: "reverse_header" },
      });
      expect(f.eventsOf("document.freshness.candidate.applied")).toHaveLength(1);
      // No provider is asked anything.
      expect(await f.providerCalls()).toEqual([]);
      // The web at the new HEAD finds nothing more to write.
      expect(await run()).toEqual({ appliedCount: 0, remaining: false });
    },
  );

  it(
    "waits for uncommitted edits and keeps a reverted line out during its hold",
    { timeout: 120_000 },
    async () => {
      const { f, run } = await setup();
      await f.write(BASE, `${BASE_CONTENT}Draft line.\n`);
      expect(await run()).toEqual({ appliedCount: 0, remaining: false });
      await f.write(BASE, BASE_CONTENT);
      expect(await run()).toEqual({ appliedCount: 1, remaining: false });
      const [applied] = await listFreshnessCandidates(f.root);
      await revertFreshnessCandidate({
        storage: f.storage,
        candidate: applied!,
        revertedBy: "owner",
        holdDays: 7,
        now: new Date(),
      });
      expect(await f.read(BASE)).toBe(BASE_CONTENT);
      expect(await run()).toEqual({ appliedCount: 0, remaining: false });
      expect(await f.read(BASE)).toBe(BASE_CONTENT);
      // A later amendment gets its own line; the reverted one stays out.
      await f.write(
        "docs/specs/decisions/0006-later.md",
        `# ADR-0006: Later\n\nStatus: \`accepted\`\nAmends: [ADR-0001](0001-base.md)\n${BODY}`,
      );
      await f.commit("docs: later decision");
      expect(await run()).toEqual({ appliedCount: 1, remaining: false });
      expect(await f.read(BASE)).toContain("Amended by: [ADR-0006](0006-later.md)\n");
      expect(await f.read(BASE)).not.toContain("[ADR-0002]");
      // After the revert hold, the reverted line may be written again, as any reverted edit may.
      const later = new Date(Date.now() + 8 * 24 * 3_600_000);
      expect(await run(later)).toEqual({ appliedCount: 1, remaining: false });
      expect(await f.read(BASE)).toContain("Amended by: [ADR-0002](0002-amend.md)\n");
    },
  );

  it(
    "waits for a declaring record's uncommitted edit and writes nothing it cannot commit",
    { timeout: 120_000 },
    async () => {
      const { f, run } = await setup();
      // The web reads working bytes: an uncommitted `Amends` line must not become a committed line.
      await f.write(AMEND, `${AMEND_CONTENT}Draft.\n`);
      expect(await run()).toEqual({ appliedCount: 0, remaining: false });
      expect(await f.read(BASE)).toBe(BASE_CONTENT);
      await f.write(AMEND, AMEND_CONTENT);
      // A held index means no commit can land, so the record is not even written.
      await f.write(".git/index.lock", "");
      expect(await run()).toEqual({ appliedCount: 0, remaining: false });
      expect(await f.read(BASE)).toBe(BASE_CONTENT);
      expect(await listFreshnessCandidates(f.root)).toEqual([]);
      await f.remove(".git/index.lock");
      expect(await run()).toEqual({ appliedCount: 1, remaining: false });
    },
  );

  it(
    "writes at most the per-cycle number of records and says more remain",
    { timeout: 120_000 },
    async () => {
      const { f } = await setup();
      const policy = documentFreshnessPolicy(await loadRepositoryKnowledgePolicy(f.root));
      for (const number of ["0004", "0005"])
        await f.write(
          `docs/specs/decisions/${number}-more.md`,
          `# ADR-${number}: More\n\nStatus: \`accepted\`\n${BODY}`,
        );
      await f.write(
        AMEND,
        AMEND_CONTENT.replace(
          "Amends: ",
          "Amends: [ADR-0004](0004-more.md), [ADR-0005](0005-more.md), ",
        ),
      );
      await f.commit("docs: more decisions");
      const now = new Date();
      await refreshRelationWeb(f.root, { commands: [], now });
      expect(
        await applyReverseHeaderEdits({
          context: { storage: f.storage, now: () => now },
          policy,
          maximumDocuments: 2,
        }),
      ).toEqual({ appliedCount: 2, remaining: true });
    },
  );

  it("runs inside the freshness cycle with no provider call", { timeout: 120_000 }, async () => {
    const { f } = await setup();
    const result = await f.cycle(new Date());
    expect(result).toMatchObject({ status: "completed" });
    expect((result as { appliedCount: number }).appliedCount).toBeGreaterThanOrEqual(1);
    expect(await f.read(BASE)).toContain("Amended by: [ADR-0002](0002-amend.md)");
    expect(await f.providerCalls()).toEqual([]);
  });
});
