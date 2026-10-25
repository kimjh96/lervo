import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { canonicalJson, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import {
  carriedParkedSources,
  KNOWLEDGE_SOURCES_PARKED,
  type ParkedConvergenceSource,
} from "../src/convergence-parking.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
const sha = (bytes: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const ref = "refs/heads/lervo/knowledge-integration";
const source = "# Source\n\nA fact worth documenting.\n";

/** One prior obligation settled `knowledge_sources_parked` with a `target_diverged` source. */
function parkedStore(parked: ParkedConvergenceSource[]) {
  const dependency = new TextEncoder().encode(
    canonicalJson({ code: KNOWLEDGE_SOURCES_PARKED, sources: parked }),
  );
  const dependencyHash = sha(dependency);
  const events = {
    list: ({ afterSeq }: { afterSeq: number }) =>
      afterSeq > 0
        ? []
        : [
            {
              seq: 1,
              type: "repository.knowledge.stage.recorded",
              payload: { failureCode: KNOWLEDGE_SOURCES_PARKED, dependencyHash },
            },
          ],
  } as unknown as OutboxStore;
  const artifacts = {
    get: async (uri: string) => {
      if (uri !== `lervo-cas://sha256/${dependencyHash.slice(7)}`) throw new Error("missing");
      return dependency;
    },
  } as unknown as ArtifactStore;
  return { events, artifacts };
}

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-target-parking-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(resolve(root, "source.md"), source);
  await writeFile(resolve(root, "guide.md"), "# Guide\n\nOn the target.\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "update-ref", ref, "HEAD");
  return root;
}

const state = {
  baseline: { sources: [{ path: "source.md", contentHash: sha(source), kind: "text" }] },
} as unknown as KnowledgeConvergenceInput;

const committed = "# Guide\n\nOn the target.\n";
const dirty = `${committed}\nAn uncommitted owner requirement.\n`;

/** The reviewed preimage is the owner's uncommitted edit; HEAD and the ref hold committed bytes. */
async function dirtyTarget() {
  const root = await repository();
  await writeFile(resolve(root, "guide.md"), dirty);
  const parked: ParkedConvergenceSource = {
    stage: "canonical",
    path: "source.md",
    contentHash: sha(source),
    reason: "target_diverged",
    attempts: 1,
    reasons: ["the target holds other bytes"],
    targets: [
      {
        ref,
        path: "guide.md",
        observedHash: sha(committed),
        headHash: sha(committed),
        preimageHash: sha(dirty),
      },
    ],
  };
  return { root, parked, store: { ...parkedStore([parked]), paths: { repositoryRoot: root } } };
}

it("carries a target_diverged source while its source and target bytes are unchanged", async () => {
  const { parked, store } = await dirtyTarget();
  expect(await carriedParkedSources(store, state)).toEqual([parked]);
});

it("readmits a target_diverged source when the owner commits the target", async () => {
  const { root, store } = await dirtyTarget();
  // The integration ref has not synchronized yet; the new HEAD bytes alone readmit the source.
  git(root, "commit", "-qam", "owner commits the requirement");
  expect(await carriedParkedSources(store, state)).toEqual([]);
});

it("readmits a target_diverged source when the integration ref moves or the target is edited", async () => {
  const moved = await dirtyTarget();
  git(moved.root, "stash", "-q");
  await writeFile(resolve(moved.root, "guide.md"), "# Guide\n\nSynchronized.\n");
  git(moved.root, "commit", "-qam", "ref only");
  git(moved.root, "update-ref", ref, "HEAD");
  git(moved.root, "reset", "-q", "--hard", "HEAD~1");
  git(moved.root, "stash", "pop", "-q");
  expect(await carriedParkedSources(moved.store, state)).toEqual([]);

  const edited = await dirtyTarget();
  await writeFile(resolve(edited.root, "guide.md"), `${dirty}Another edit.\n`);
  expect(await carriedParkedSources(edited.store, state)).toEqual([]);
});

it("drops a target_diverged record that names no target", async () => {
  const root = await repository();
  const store = {
    ...parkedStore([
      {
        stage: "canonical",
        path: "source.md",
        contentHash: sha(source),
        reason: "target_diverged",
        attempts: 1,
        reasons: [],
      },
    ]),
    paths: { repositoryRoot: root },
  };
  expect(await carriedParkedSources(store, state)).toEqual([]);
});
