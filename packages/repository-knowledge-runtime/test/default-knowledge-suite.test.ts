import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadVerificationSuite } from "@lervo/verification";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_KNOWLEDGE_SUITE_CONTENT,
  DEFAULT_KNOWLEDGE_SUITE_ID,
  DEFAULT_KNOWLEDGE_SUITE_PATH,
  ensureDefaultKnowledgeSuite,
  ensureSeedDefaultSuite,
  restoreDefaultKnowledgeSuite,
  selectOwnerSuite,
  selectRepositoryDefaultSuite,
  unboundSuiteFailure,
} from "../src/default-knowledge-suite.js";
import { readInstalledDefinitions } from "../src/delegation-definition-ledger.js";
import { verificationEnvironment } from "../src/verification-environment.js";
import { fixture } from "./fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function repository() {
  const f = await fixture(false);
  cleanups.push(async () => {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return f;
}

describe("the suite seeding binds (ADR-0655)", () => {
  it("prefers any owner suite, and takes Lervo's default only when there is none", () => {
    expect(selectRepositoryDefaultSuite([])).toBeNull();
    expect(selectRepositoryDefaultSuite([DEFAULT_KNOWLEDGE_SUITE_ID])).toBe(
      DEFAULT_KNOWLEDGE_SUITE_ID,
    );
    expect(selectRepositoryDefaultSuite([DEFAULT_KNOWLEDGE_SUITE_ID, "repository.default"])).toBe(
      "repository.default",
    );
    expect(
      selectRepositoryDefaultSuite([DEFAULT_KNOWLEDGE_SUITE_ID, "repository.default.v2", "x"]),
    ).toBe("repository.default.v2");
    // The default never makes an owner's single suite ambiguous.
    expect(selectRepositoryDefaultSuite([DEFAULT_KNOWLEDGE_SUITE_ID, "project.checks"])).toBe(
      "project.checks",
    );
    expect(selectRepositoryDefaultSuite(["a", "b", DEFAULT_KNOWLEDGE_SUITE_ID])).toBeNull();
    expect(selectRepositoryDefaultSuite(["lervo.pilot.x"])).toBeNull();
  });
});

describe("installing Lervo's default suite (ADR-0655)", () => {
  it("installs a valid suite once, records it as Lervo-managed, and leaves an owner suite alone", async () => {
    const f = await repository();
    const now = new Date("2026-11-28T06:00:00.000Z");
    expect(await ensureDefaultKnowledgeSuite({ storage: f.storage, now })).toBe(true);
    expect(await readFile(resolve(f.root, DEFAULT_KNOWLEDGE_SUITE_PATH), "utf8")).toBe(
      DEFAULT_KNOWLEDGE_SUITE_CONTENT,
    );
    const suite = await loadVerificationSuite(f.root, DEFAULT_KNOWLEDGE_SUITE_ID);
    expect(suite.commands.map((command) => [command.executable, ...command.arguments])).toEqual([
      ["lervo", "knowledge", "lint"],
    ]);
    expect((await readInstalledDefinitions(f.root)).map((entry) => entry.path)).toEqual([
      DEFAULT_KNOWLEDGE_SUITE_PATH,
    ]);
    // Idempotent: a second cycle installs nothing.
    expect(await ensureDefaultKnowledgeSuite({ storage: f.storage, now })).toBe(false);
  });

  it("never installs beside a suite the owner configured, unless a peer's scope binds the default", async () => {
    const f = await repository();
    await mkdir(resolve(f.root, ".lervo/verifications"), { recursive: true });
    await writeFile(
      resolve(f.root, ".lervo/verifications/repository.default.yaml"),
      DEFAULT_KNOWLEDGE_SUITE_CONTENT.replace(DEFAULT_KNOWLEDGE_SUITE_ID, "repository.default"),
    );
    const now = new Date("2026-11-28T06:00:00.000Z");
    expect(await ensureDefaultKnowledgeSuite({ storage: f.storage, now })).toBe(false);
    await expect(readFile(resolve(f.root, DEFAULT_KNOWLEDGE_SUITE_PATH))).rejects.toThrow();
    expect(await ensureDefaultKnowledgeSuite({ storage: f.storage, now, boundByPeer: true })).toBe(
      true,
    );
  });

  it("installs the default for a peer seed only when the peer's scope binds it", async () => {
    const f = await repository();
    const now = new Date("2026-11-28T06:00:00.000Z");
    const binds = (suiteId: string) => ({ verification: [{ suiteId, suiteHash: "sha256:x" }] });
    expect(
      await ensureSeedDefaultSuite({ storage: f.storage, now, peerScope: binds("knowledge.x") }),
    ).toBe(false);
    await expect(readFile(resolve(f.root, DEFAULT_KNOWLEDGE_SUITE_PATH))).rejects.toThrow();
    expect(
      await ensureSeedDefaultSuite({
        storage: f.storage,
        now,
        peerScope: binds(DEFAULT_KNOWLEDGE_SUITE_ID),
      }),
    ).toBe(true);
    // A template seed (no peer scope) installs it in a repository without a suite.
    const g = await repository();
    expect(await ensureSeedDefaultSuite({ storage: g.storage, now })).toBe(true);
  });
});

describe("what seeding does without one suite to bind (ADR-0655)", () => {
  it("installs nothing beside several owner suites and names the ambiguity", async () => {
    const f = await repository();
    await mkdir(resolve(f.root, ".lervo/verifications"), { recursive: true });
    for (const id of ["project.default", "role.x"])
      await writeFile(
        resolve(f.root, `.lervo/verifications/${id}.yaml`),
        DEFAULT_KNOWLEDGE_SUITE_CONTENT.replace(DEFAULT_KNOWLEDGE_SUITE_ID, id),
      );
    const now = new Date("2026-11-28T06:00:00.000Z");
    expect(await ensureDefaultKnowledgeSuite({ storage: f.storage, now })).toBe(false);
    await expect(readFile(resolve(f.root, DEFAULT_KNOWLEDGE_SUITE_PATH))).rejects.toThrow();
    expect(unboundSuiteFailure(["project.default", "role.x"])).toBe(
      "convergence_seed_verification_ambiguous",
    );
    expect(unboundSuiteFailure([])).toBe("convergence_seed_verification_missing");
  });

  it("gives way to the owner's own suite and finds none while only the default exists", () => {
    expect(selectOwnerSuite([DEFAULT_KNOWLEDGE_SUITE_ID])).toBeNull();
    expect(selectOwnerSuite([DEFAULT_KNOWLEDGE_SUITE_ID, "repository.default.v1"])).toBe(
      "repository.default.v1",
    );
  });

  it("puts back the default it installed after the file is removed, and nothing it never installed", async () => {
    const f = await repository();
    const now = new Date("2026-11-28T06:00:00.000Z");
    expect(await restoreDefaultKnowledgeSuite(f.root)).toBe(false);
    await ensureDefaultKnowledgeSuite({ storage: f.storage, now });
    await rm(resolve(f.root, DEFAULT_KNOWLEDGE_SUITE_PATH));
    expect(await restoreDefaultKnowledgeSuite(f.root)).toBe(true);
    expect(await readFile(resolve(f.root, DEFAULT_KNOWLEDGE_SUITE_PATH), "utf8")).toBe(
      DEFAULT_KNOWLEDGE_SUITE_CONTENT,
    );
    expect(await restoreDefaultKnowledgeSuite(f.root)).toBe(false);
  });
});

describe("the lervo a verification suite runs (ADR-0655)", () => {
  it("is the CLI this process runs, ahead of any lervo on the PATH", async () => {
    const f = await repository();
    const entry = resolve(f.directory, "fake-cli.mjs");
    await writeFile(entry, "process.stdout.write(process.argv.slice(2).join(' '));\n");
    const environment = await verificationEnvironment(
      async () => ({ environment: { PATH: "/usr/bin:/bin" }, failure: null }) as never,
      entry,
    );
    const shim = environment.PATH!.split(":")[0]!;
    expect(environment.PATH).toBe(`${shim}:/usr/bin:/bin`);
    expect((await stat(resolve(shim, "lervo"))).mode & 0o111).not.toBe(0);
    const { execFileSync } = await import("node:child_process");
    expect(
      execFileSync("lervo", ["knowledge", "lint"], { env: environment, encoding: "utf8" }),
    ).toBe("knowledge lint");
    // Without a usable entry the PATH lookup stands.
    const plain = await verificationEnvironment(
      async () => ({ environment: { PATH: "/usr/bin:/bin" }, failure: null }) as never,
      undefined,
    );
    expect(plain.PATH).toBe("/usr/bin:/bin");
  });
});
