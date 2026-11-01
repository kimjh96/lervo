import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyFreshnessCandidateByOwner } from "../src/freshness-apply.js";
import { revertFreshnessCandidate } from "../src/freshness-revert.js";
import { listFreshnessCandidates } from "../src/freshness-state-store.js";
import { freshnessFixture, type FreshnessFixture } from "./freshness-fixture.js";

const fixtures: FreshnessFixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function setup() {
  const f = await freshnessFixture();
  fixtures.push(f);
  return f;
}

const AGENTS_V2 = [
  "# Repository instructions",
  "",
  "Keep runtime requirements and user-owned content unchanged.",
  "",
  "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`.",
  "The live engine starts from `v2/argo_v2/live/engine.py`.",
  "",
].join("\n");

const README_V2 = [
  "# Repository",
  "",
  "See [runtime](docs/specs/runtime.md).",
  "",
  "Read the [v2 guide](v2/README.md). Learning runs every 6 hours.",
  "",
].join("\n");

/** Replays the Argo v2-to-v4 replacement: v2 exists at the verified revision, v4 replaces it. */
async function argoHistory(f: FreshnessFixture, documents: Record<string, string>) {
  await f.write("v2/argo_v2/live/engine.py", "class Limits:\n    maximum_leverage = 2\n");
  await f.write("v2/README.md", "# v2\n\nLearning runs every 6 hours.\n");
  for (const [path, content] of Object.entries(documents)) await f.write(path, content);
  await f.commit("add v2 and its documents");
  await f.remove("v2");
  await f.write("v4/argo4/live/engine.py", "class Limits:\n    maximum_leverage = 1\n");
  await f.write("v4/README.md", "# v4\n\nLearning runs daily at 00:40 UTC.\n");
  await f.commit("replace v2 with v4");
}

describe("document freshness fixtures (ADR-0463)", () => {
  it(
    "F1 holds a safety correction to AGENTS.md for the owner in the first cycle",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await argoHistory(f, { "AGENTS.md": AGENTS_V2 });
      await f.plan({
        "AGENTS.md": {
          operation: "edit",
          hunks: [
            {
              before: "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`.",
              after: "Hard risk limits live in `v4/argo4/live/engine.py: Limits`.",
              evidencePaths: ["v4/argo4/live/engine.py"],
            },
            {
              before: "The live engine starts from `v2/argo_v2/live/engine.py`.",
              after: "The live engine starts from `v4/argo4/live/engine.py`.",
              evidencePaths: ["v4/argo4/live/engine.py"],
            },
          ],
        },
      });
      const result = await f.cycle();
      expect(result).toMatchObject({ status: "completed", candidateCount: 1, appliedCount: 0 });
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({
        documentPath: "AGENTS.md",
        priorityClass: "safety",
        operation: "edit",
        state: "verified_pending_cross_check",
        crossCheck: "unavailable",
        authorityRequired: "owner",
      });
      expect(candidate!.hunks.map((hunk) => hunk.changeClass)).toEqual([
        "safety_or_policy",
        "safety_or_policy",
      ]);
      expect(candidate!.checks.every((check) => check.status === "passed")).toBe(true);
      expect(await f.read("AGENTS.md")).toBe(AGENTS_V2);
      expect(f.eventsOf("document.freshness.candidate.created")).toHaveLength(1);
      expect(f.eventsOf("document.freshness.candidate.verified")).toHaveLength(1);
      expect(f.eventsOf("document.freshness.candidate.applied")).toHaveLength(0);
      const usage = f
        .eventsOf("resource.usage.recorded")
        .map((event) => event.payload as Record<string, unknown>)
        .filter((payload) => payload.stage === "document_freshness");
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ channel: "knowledge_worker", status: "observed" });
      expect(digest(AGENTS_V2)).toBe(candidate!.sourceHash);
    },
  );

  const readmePlan = {
    "README.md": {
      operation: "edit" as const,
      hunks: [
        {
          before: "[v2 guide](v2/README.md)",
          after: "[v4 guide](v4/README.md)",
          evidencePaths: ["v4/README.md"],
        },
        { before: "every 6 hours", after: "daily at 00:40 UTC", evidencePaths: ["v4/README.md"] },
      ],
    },
  };

  it(
    "defers without spend or a rejected candidate when the provider fails before any model call",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await argoHistory(f, { "README.md": README_V2 });
      await f.plan(readmePlan);
      // The version check fails, as an unusable CLI does, before any model call.
      await writeFile(f.executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      const result = await f.cycle();
      expect(result).not.toMatchObject({ candidateCount: 1 });
      expect(await listFreshnessCandidates(f.root)).toEqual([]);
      expect(await f.providerCalls()).toEqual([]);
      expect(f.eventsOf("document.freshness.candidate.rejected")).toHaveLength(0);
      const charged = f
        .eventsOf("resource.usage.recorded")
        .map((event) => event.payload as Record<string, unknown>)
        .filter((payload) => payload.stage === "document_freshness");
      expect(charged).toEqual([]);
    },
  );

  async function readmeCandidate(f: FreshnessFixture) {
    await argoHistory(f, { "README.md": README_V2 });
    await f.plan(readmePlan);
    expect(await f.cycle()).toMatchObject({ status: "completed", candidateCount: 1 });
    const [candidate] = await listFreshnessCandidates(f.root);
    return candidate!;
  }

  it(
    "F2 classifies README reference updates as factual and gates the user-owned bytes on the owner",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const candidate = await readmeCandidate(f);
      expect(candidate).toMatchObject({
        documentPath: "README.md",
        priorityClass: "entrypoint",
        state: "verified_pending_cross_check",
        authorityRequired: "owner",
      });
      expect(
        candidate.hunks.map((hunk) => [hunk.changeClass, hunk.ownership, hunk.authorityRequired]),
      ).toEqual([
        ["factual_reference", "user_owned", "owner"],
        ["factual_reference", "user_owned", "owner"],
      ]);
      expect(candidate.checks.find((check) => check.code === "references_resolve")?.status).toBe(
        "passed",
      );
      expect(await f.read("README.md")).toBe(README_V2);
    },
  );

  it(
    "F3 archives a superseded root design with a banner and nine inbound link rewrites",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await f.write("IMPLEMENTATION-HANDOFF.md", "# Handoff\n\nThe v1 handoff.\n");
      await f.write(
        "FINAL-DESIGN.md",
        "# Final design\n\nThis v1 design follows [the handoff](IMPLEMENTATION-HANDOFF.md).\n",
      );
      for (let index = 1; index <= 9; index += 1)
        await f.write(
          `docs/notes/note-${index}.md`,
          `# Note ${index}\n\nSee [the final design](../../FINAL-DESIGN.md).\n`,
        );
      await f.commit("add the v1 design");
      await f.remove("IMPLEMENTATION-HANDOFF.md");
      await f.commit("remove v1");
      await f.plan({
        "FINAL-DESIGN.md": {
          operation: "archive",
          archiveName: "v1-final-design.md",
          currentDocumentPath: "docs/specs/runtime.md",
        },
      });
      await f.cycle();
      const candidate = (await listFreshnessCandidates(f.root)).find(
        (item) => item.documentPath === "FINAL-DESIGN.md",
      )!;
      expect(candidate).toMatchObject({
        operation: "archive",
        state: "verified_pending_cross_check",
        authorityRequired: "owner",
      });
      expect(candidate.archive?.targetPath).toBe("docs/archive/v1-final-design.md");
      expect(candidate.archive?.inboundLinkRewrites).toHaveLength(9);
      expect(candidate.archive?.banner).toMatch(/^> Historical: archived on \d{4}-\d{2}-\d{2}\./u);
      const applied = await applyFreshnessCandidateByOwner({
        storage: f.storage,
        candidate,
        approvalHash: candidate.afterHash!,
        reviewer: "owner",
        now: new Date(),
      });
      expect(applied.state).toBe("applied");
      expect(await f.read("docs/archive/v1-final-design.md")).toMatch(
        /^> Historical: archived on/u,
      );
      expect(await f.read("docs/notes/note-1.md")).toContain("(../archive/v1-final-design.md)");
      expect(await f.git(["log", "-1", "--format=%an%n%B"])).toContain(
        `Lervo-Freshness-Candidate: ${candidate.candidateId}`,
      );
    },
  );

  it(
    "F4 ignores unrelated edits and settles a review-interval-only finding without a provider call",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await f.write("src/stable.ts", "export const stable = true;\n");
      await f.write("docs/specs/stable.md", "# Stable\n\nThe flag lives in `src/stable.ts`.\n");
      await f.commit("add a stable document", "2023-01-02T00:00:00Z");
      await f.write("v3/scripts/run.sh", "echo run\n");
      await f.commit("unrelated script edit");
      await f.plan({});
      await f.cycle();
      const candidates = await listFreshnessCandidates(f.root);
      expect(
        candidates.map((candidate) => [
          candidate.documentPath,
          candidate.operation,
          candidate.state,
        ]),
      ).toEqual([["docs/specs/stable.md", "no_change_needed", "verified"]]);
      expect(await f.providerCalls()).toEqual([]);
    },
  );

  it(
    "F5 supersedes a waiting candidate when the owner edits the document and regenerates after commit",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const first = await readmeCandidate(f);
      await f.write("README.md", `${README_V2}\nAn owner note.\n`);
      await f.cycle(new Date(Date.now() + 1_000));
      const superseded = (await listFreshnessCandidates(f.root)).find(
        (item) => item.candidateId === first.candidateId,
      );
      expect(superseded).toMatchObject({
        state: "superseded",
        rejection: { reasonCode: "source_changed" },
      });
      expect(
        f
          .eventsOf("document.freshness.candidate.rejected")
          .map((event) => event.payload.reasonCode),
      ).toContain("source_changed");
      await f.commit("owner note");
      await f.cycle(new Date(Date.now() + 2_000));
      const next = (await listFreshnessCandidates(f.root)).filter(
        (item) =>
          item.documentPath === "README.md" && item.state === "verified_pending_cross_check",
      );
      expect(next).toHaveLength(1);
      expect(next[0]!.candidateId).not.toBe(first.candidateId);
    },
  );

  it(
    "F6 applies the README candidate for the owner, reverts it, and holds the finding",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const candidate = await readmeCandidate(f);
      await expect(
        applyFreshnessCandidateByOwner({
          storage: f.storage,
          candidate,
          approvalHash: digest("wrong"),
          reviewer: "owner",
          now: new Date(),
        }),
      ).rejects.toMatchObject({ code: "approval_mismatch" });
      const applied = await applyFreshnessCandidateByOwner({
        storage: f.storage,
        candidate,
        approvalHash: candidate.afterHash!,
        reviewer: "owner",
        now: new Date(),
      });
      expect(applied).toMatchObject({ state: "applied", appliedHash: candidate.afterHash });
      expect(await f.read("README.md")).toContain(
        "[v4 guide](v4/README.md). Learning runs daily at 00:40 UTC.",
      );
      expect(applied.commitHash).toMatch(/^[a-f0-9]{40}$/u);
      const log = await f.git(["log", "-1", "--format=%an%n%B"]);
      expect(log.startsWith("Lervo Knowledge\n")).toBe(true);
      expect(log).toContain(`Lervo-Freshness-Candidate: ${candidate.candidateId}`);
      const reverted = await revertFreshnessCandidate({
        storage: f.storage,
        candidate: applied,
        revertedBy: "owner",
        holdDays: 7,
        now: new Date(),
      });
      expect(reverted.state).toBe("reverted");
      expect(await f.read("README.md")).toBe(README_V2);
      expect(f.eventsOf("document.freshness.candidate.reverted")).toHaveLength(1);
      const later = await f.cycle(new Date(Date.now() + 86_400_000));
      expect(later).toMatchObject({ status: "completed", candidateCount: 0 });
      expect(
        f.eventsOf("document.freshness.cycle.completed").at(-1)?.payload.skippedForHold,
      ).toBeGreaterThanOrEqual(1);
    },
  );

  it(
    "F7 applies the managed-block hunk itself and leaves the user prose hunk with the owner",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const agents = (routes: string, guide: string) =>
        [
          "# Repository instructions",
          "",
          "Keep runtime requirements and user-owned content unchanged.",
          "",
          "<!-- lervo:begin block=routes schema=1 -->",
          `Generated routes are listed in \`${routes}\`.`,
          "<!-- lervo:end block=routes -->",
          "",
          `The build guide lives in \`${guide}\`.`,
          "",
        ].join("\n");
      await f.write("docs/old/routes.md", "# Routes\n\nThe generated route table.\n");
      await f.write("ops/old-build.md", "# Build\n\nThe build guide.\n");
      await f.write("AGENTS.md", agents("docs/old/routes.md", "ops/old-build.md"));
      await f.commit("add routes and build guide");
      await f.git(["mv", "docs/old/routes.md", "docs/routes.md"]);
      await f.git(["mv", "ops/old-build.md", "ops/build.md"]);
      await f.commit("move routes and build guide");
      await f.plan({
        "AGENTS.md": {
          operation: "edit",
          hunks: [
            {
              before: "Generated routes are listed in `docs/old/routes.md`.",
              after: "Generated routes are listed in `docs/routes.md`.",
              evidencePaths: ["docs/routes.md"],
            },
            {
              before: "The build guide lives in `ops/old-build.md`.",
              after: "The build guide lives in `ops/build.md`.",
              evidencePaths: ["ops/build.md"],
            },
          ],
        },
      });
      await f.cycle();
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({ state: "partially_applied", authorityRequired: "owner" });
      const [managed, prose] = candidate!.hunks;
      expect(managed).toMatchObject({
        ownership: "lervo_managed",
        managedBlockId: "routes",
        changeClass: "factual_reference",
        authorityRequired: "none",
        crossCheckRequired: false,
      });
      expect(prose).toMatchObject({ ownership: "user_owned", authorityRequired: "owner" });
      expect(candidate!.appliedHunkIds).toEqual([managed!.hunkId]);
      expect(candidate!.pendingHunkIds).toEqual([prose!.hunkId]);
      expect(await f.read("AGENTS.md")).toBe(agents("docs/routes.md", "ops/old-build.md"));
      expect(f.eventsOf("document.freshness.candidate.applied").at(-1)?.payload).toMatchObject({
        approvalSource: "lervo_managed",
        appliedHunkCount: 1,
        pendingHunkCount: 1,
      });
      const owner = await applyFreshnessCandidateByOwner({
        storage: f.storage,
        candidate: candidate!,
        approvalHash: candidate!.afterHash!,
        reviewer: "owner",
        now: new Date(),
      });
      expect(owner.state).toBe("applied");
      expect(await f.read("AGENTS.md")).toBe(agents("docs/routes.md", "ops/build.md"));
    },
  );
});
