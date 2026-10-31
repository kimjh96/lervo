import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import {
  shardedKnowledgeArtifactPath,
  structuralConceptDirectory,
} from "@lervo/repository-knowledge";

import { runCli } from "../src/main.js";
import type { ManagedDeliberationOutcome } from "../src/managed-deliberation.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo CLI identity", () => {
  it("reports the CLI package version without opening project storage", async () => {
    let output = "";
    let errors = "";
    let storageOpened = false;
    const exitCode = await runCli(
      ["--version"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          errors += message;
        },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toMatch(/^lervo \d+\.\d+\.\d+\n$/);
    expect(errors).toBe("");
    expect(storageOpened).toBe(false);
  });

  it("rejects extra version arguments", async () => {
    let errors = "";
    expect(
      await runCli(["--version", "extra"], {
        cwd: process.cwd(),
        stdout: () => undefined,
        stderr: (message) => {
          errors += message;
        },
      }),
    ).toBe(1);
    expect(errors).toContain("does not accept additional arguments");
  });
});

describe("lervo init CLI", () => {
  it("prints the exact creation plan without mutating on dry-run", async () => {
    const root = await temporaryRepository();
    let output = "";
    const exitCode = await runCli(["init", "--dry-run", "--name", "fixture"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("create  .lervo/project.yaml");
    expect(output).toContain("+ name: fixture");
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });

  it("applies init and reports an idempotent second run", async () => {
    const root = await temporaryRepository();
    const messages: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => messages.push(message),
    };

    expect(await runCli(["init"], io)).toBe(0);
    expect(await runCli(["init"], io)).toBe(0);
    expect(messages.join("")).toContain("Initialized the Lervo project.");
    expect(messages.join("")).toContain("The project is already initialized.");
  });

  it("advances safe onboarding stages from init and stops at provider authority", async () => {
    const root = await temporaryRepository();
    const messages: string[] = [];
    expect(
      await runCli(["init", "--onboard"], {
        cwd: root,
        stdout: (message: string) => messages.push(message),
        stderr: (message: string) => messages.push(message),
      }),
    ).toBe(0);
    expect(messages.join("")).toContain("Onboarding: pending_authority");
    expect(messages.join("")).toContain("initial agent: agt_");
    await expect(access(resolve(root, "docs/knowledge/index.md"))).resolves.toBeUndefined();
    await expect(access(resolve(root, "AGENTS.md"))).resolves.toBeUndefined();
  });
});

describe("lervo migrate identity CLI", () => {
  it("keeps a missing previous state read-only and explains the blocker", async () => {
    const root = await temporaryRepository();
    let output = "";
    let errors = "";

    const exitCode = await runCli(["migrate", "identity"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: (message) => {
        errors += message;
      },
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("Plan status: blocked");
    expect(output).toContain("previous managed path does not exist");
    expect(errors).toBe("");
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });
});

describe("lervo repository knowledge CLI", () => {
  it("runs dry-run, apply, lint and query with a recorded materialization event", async () => {
    const root = await temporaryRepository();
    await writeFile(resolve(root, "main.ts"), "export const greeting = 'hello';\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operations: Array<{ content?: unknown }>;
    };
    expect(plan.operations.every((operation) => operation.content === undefined)).toBe(true);
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", plan.planId, "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      type: "knowledge.materialization.applied",
    });
    expect(await readFile(resolve(root, "docs/knowledge/index.md"), "utf8")).toContain(
      "Repository knowledge",
    );

    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });

    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "repository"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      semantics: "recommended",
      ranking: { engine: { id: "lexical", version: 2 } },
      hits: [expect.objectContaining({ path: "docs/knowledge/index.md" })],
    });

    messages.length = 0;
    expect(await runCli(["knowledge", "impact", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      status: "current",
      lineageComplete: true,
      summary: { current: 0, stale: 0, unknown: 0, affectedConcepts: 0 },
      items: [],
    });

    messages.length = 0;
    expect(await runCli(["knowledge", "refresh-candidate", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      semantics: "review_candidate",
      status: "no_changes",
      automaticPublicationMutation: false,
      items: [],
    });

    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events.list().some((event) => event.type === "knowledge.materialization.applied"),
      ).toBe(true);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("deletes an exact registered user document and deprecates its concept atomically", async () => {
    const root = await temporaryRepository();
    const documentPath = "docs/research/retired.md";
    await writeFile(resolve(root, "seed.txt"), "seed\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(resolve(root, documentPath), "# Retired note\n\nExact user bytes to remove.\n");
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(await runCli(["knowledge", "structure", "delete", documentPath, "--json"], io)).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      deprecatedConceptIds: string[];
      operations: Array<{ path: string; action: string; content?: string }>;
    };
    expect(plan.deprecatedConceptIds).toHaveLength(1);
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: documentPath, action: "delete" }),
    );
    expect(plan.operations.every((operation) => operation.content === undefined)).toBe(true);
    expect(await readFile(resolve(root, documentPath), "utf8")).toContain("Exact user bytes");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "delete",
          documentPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("exact approval hash");
    expect(await readFile(resolve(root, documentPath), "utf8")).toContain("Exact user bytes");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "delete",
          documentPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    await expect(access(resolve(root, documentPath))).rejects.toMatchObject({ code: "ENOENT" });
    const conceptBytes = await readFile(
      resolve(
        root,
        shardedKnowledgeArtifactPath(
          structuralConceptDirectory,
          plan.deprecatedConceptIds[0]!,
          "yaml",
        ),
      ),
      "utf8",
    );
    expect(conceptBytes).toContain("publicationStatus: deprecated");
    expect(conceptBytes).toContain("kind: document_deleted");

    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    const refreshPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--apply", refreshPlanId, "--json"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Retired note"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> }).hits,
    ).toEqual([]);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_delete",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        deprecatedConceptIds: plan.deprecatedConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(documentPath);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("moves an exact registered user document while preserving identity and navigation", async () => {
    const root = await temporaryRepository();
    const sourcePath = "docs/research/original.md";
    const destinationPath = "docs/research/current.md";
    await writeFile(resolve(root, "seed.txt"), "seed\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(
      resolve(root, sourcePath),
      "# Movable guide\n\nExact user bytes remain unchanged.\n",
    );
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(
      await runCli(["knowledge", "structure", "move", sourcePath, destinationPath, "--json"], io),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      preservedConceptIds: string[];
      operations: Array<{ action: string; content?: string }>;
    };
    expect(plan.preservedConceptIds).toHaveLength(1);
    expect(plan.operations.some((item) => item.action === "move")).toBe(true);
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "move",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toContain("Exact user bytes");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "move",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    await expect(access(resolve(root, sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, destinationPath), "utf8")).toContain("Exact user bytes");
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Movable guide"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> })
        .hits[0],
    ).toMatchObject({ conceptId: plan.preservedConceptIds[0], path: destinationPath });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { operations: Array<{ action: string }> }).operations.every(
        (item) => item.action === "unchanged",
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_move",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        updatedConceptIds: plan.preservedConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(sourcePath);
      expect(JSON.stringify(event?.payload)).not.toContain(destinationPath);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("splits one exact CommonMark heading subtree into a new registered document", async () => {
    const root = await temporaryRepository();
    const sourcePath = "docs/research/guide.md";
    const destinationPath = "docs/research/extracted.md";
    const original =
      "# Guide\n\nIntro.\n\n## Keep\n\nKeep this.\n\n## Extract\n\nMove this.\n\n### Nested\n\nMove nested too.\n\n## Tail\n\nKeep tail.\n";
    const remainder = "# Guide\n\nIntro.\n\n## Keep\n\nKeep this.\n\n## Tail\n\nKeep tail.\n";
    const extracted = "## Extract\n\nMove this.\n\n### Nested\n\nMove nested too.\n\n";
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(resolve(root, sourcePath), original);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "split",
          sourcePath,
          destinationPath,
          "--at-heading",
          "heading:Guide > Extract",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      createdConceptIds: string[];
      operations: Array<{ ownership: string; content?: string }>;
    };
    expect(plan.createdConceptIds).toHaveLength(1);
    expect(plan.operations.some((item) => item.ownership === "user")).toBe(true);
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "split",
          sourcePath,
          destinationPath,
          "--at-heading",
          "heading:Guide > Extract",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(original);
    await expect(access(resolve(root, destinationPath))).rejects.toMatchObject({ code: "ENOENT" });

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "split",
          sourcePath,
          destinationPath,
          "--at-heading",
          "heading:Guide > Extract",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(remainder);
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(extracted);
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Extract"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> })
        .hits[0],
    ).toMatchObject({ conceptId: plan.createdConceptIds[0], path: destinationPath });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { operations: Array<{ action: string }> }).operations.every(
        (item) => item.action === "unchanged",
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_split",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        createdConceptIds: plan.createdConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(sourcePath);
      expect(JSON.stringify(event?.payload)).not.toContain(destinationPath);
      expect(JSON.stringify(event?.payload)).not.toContain("Move this");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("merges one registered source into a registered destination with exact approval", async () => {
    const root = await temporaryRepository();
    const sourcePath = "docs/research/source.md";
    const destinationPath = "docs/research/destination.md";
    const source = "# Source\n\nSource-only body.\n";
    const destination = "# Destination\n\nDestination body.\n\n";
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(resolve(root, sourcePath), source);
    await writeFile(resolve(root, destinationPath), destination);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(
      await runCli(["knowledge", "structure", "merge", sourcePath, destinationPath, "--json"], io),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      preservedConceptIds: string[];
      deprecatedConceptIds: string[];
      operations: Array<{ action: string; ownership?: string; content?: string }>;
    };
    expect(plan.preservedConceptIds).toHaveLength(1);
    expect(plan.deprecatedConceptIds).toHaveLength(1);
    expect(plan.operations.some((item) => item.action === "delete")).toBe(true);
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "merge",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(source);
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(destination);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "merge",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    await expect(access(resolve(root, sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(destination + source);
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Source-only body"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> })
        .hits[0],
    ).toMatchObject({ conceptId: plan.preservedConceptIds[0], path: destinationPath });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { operations: Array<{ action: string }> }).operations.every(
        (item) => item.action === "unchanged",
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_merge",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        deprecatedConceptIds: plan.deprecatedConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(sourcePath);
      expect(JSON.stringify(event?.payload)).not.toContain(destinationPath);
      expect(JSON.stringify(event?.payload)).not.toContain("Source-only body");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("creates and records a privacy-bounded Claude instruction bridge", async () => {
    const root = await temporaryRepository();
    await writeFile(
      resolve(root, "AGENTS.md"),
      "# Canonical agent policy\n\nRepository instructions.\n",
    );
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);

    messages.length = 0;
    expect(
      await runCli(["knowledge", "instruction", "bridge", "--provider", "claude", "--json"], io),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      target: { action: string };
      operations: Array<{ content?: string }>;
    };
    expect(plan.target.action).toBe("create");
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);
    await expect(access(resolve(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "bridge",
          "--provider",
          "claude",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("exact approval hash");
    await expect(access(resolve(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "bridge",
          "--provider",
          "claude",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
      errors.join(""),
    ).toBe(0);
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md\n");
    const receipt = JSON.parse(messages.join("")) as {
      canonicalPathDigest: string;
      targetPathDigest: string;
    };
    expect(receipt.canonicalPathDigest).toMatch(/^sha256:/);
    expect(receipt.targetPathDigest).toMatch(/^sha256:/);

    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "instruction_bridge_update",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        compilerId: "lervo.instruction-bridge",
      });
      expect(JSON.stringify(event?.payload)).not.toContain("AGENTS.md");
      expect(JSON.stringify(event?.payload)).not.toContain("CLAUDE.md");
      expect(JSON.stringify(event?.payload)).not.toContain("Repository instructions");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("exchanges an OKF bundle with another Lervo using a read-only same-ID import plan", async () => {
    const source = await temporaryRepository();
    const target = await temporaryRepository();
    const exchangeParent = await temporaryRepository();
    const messages: string[] = [];
    const errors: string[] = [];
    const sourceIo = {
      cwd: source,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], sourceIo)).toBe(0);
    await writeFile(
      resolve(source, "README.md"),
      "# Exchange fixture\n\nPortable quasar knowledge.\n",
    );
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], sourceIo)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], sourceIo),
    ).toBe(0);
    messages.length = 0;
    const bundle = resolve(exchangeParent, "bundle");
    expect(
      await runCli(["knowledge", "export", "okf", "--output", bundle, "--json"], sourceIo),
    ).toBe(0);
    const exported = JSON.parse(messages.join("")) as { bundleDigest: string };

    const targetIo = {
      cwd: target,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    messages.length = 0;
    expect(await runCli(["init"], targetIo)).toBe(0);
    messages.length = 0;
    expect(await runCli(["knowledge", "import", "okf", bundle, "--json"], targetIo)).toBe(0);
    const importPlan = JSON.parse(messages.join("")) as {
      planId: string;
      candidateId: string;
      targetPath: string;
      bundleDigest: string;
    };
    expect(importPlan.bundleDigest).toBe(exported.bundleDigest);
    await expect(access(resolve(target, importPlan.targetPath))).rejects.toThrow();
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "import", "okf", bundle, "--apply", importPlan.planId, "--json"],
        targetIo,
      ),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      candidateId: importPlan.candidateId,
      created: true,
      localAssurance: "unreviewed",
    });

    messages.length = 0;
    expect(await runCli(["knowledge", "okf", "query", bundle, "quasar", "--json"], targetIo)).toBe(
      0,
    );
    expect(JSON.parse(messages.join(""))).toMatchObject({
      semantics: "recommended",
      hits: [expect.objectContaining({ localAssurance: "unreviewed" })],
    });
    const roundtrip = resolve(exchangeParent, "roundtrip");
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "okf", "re-export", importPlan.candidateId, "--output", roundtrip, "--json"],
        targetIo,
      ),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ bundleDigest: exported.bundleDigest });
    expect(await readFile(resolve(roundtrip, "index.md"), "utf8")).toBe(
      await readFile(resolve(bundle, "index.md"), "utf8"),
    );
    const storage = await openProjectStorage(target);
    try {
      expect(storage.events.list()).toEqual([]);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });
});

describe("lervo run CLI arguments", () => {
  it("rejects an incomplete run command before opening a managed run", async () => {
    const root = await temporaryRepository();
    let called = false;
    let errorOutput = "";
    const exitCode = await runCli(
      ["run", "--provider", "codex", "task"],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => {
          errorOutput += message;
        },
      },
      {
        executeManagedRun: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errorOutput).toContain(
      "A provider, path, verification suite, and task request are required",
    );
  });
});

describe("lervo deliberate CLI", () => {
  it("reports a missing automatic verification suite as an actionable preflight state", async () => {
    const root = await temporaryRepository();
    let called = false;
    let errors = "";
    const exitCode = await runCli(
      ["deliberate", "--auto", "--caller", "codex", "Review this change."],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => {
          errors += message;
        },
      },
      {
        executeManagedDeliberation: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errors).toContain("deliberation_verification_unconfigured");
    expect(errors).toContain("provider execution has not started");
  });

  it("resolves a natural terminal request to the repository default cross-provider workflow", async () => {
    const root = await temporaryRepository();
    await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
    await writeFile(resolve(root, ".lervo/verifications/repository.default.yaml"), "fixture\n");
    let request: unknown;
    const exitCode = await runCli(
      ["deliberate", "--auto", "--caller", "claude", "Review the proposed UX writing change."],
      { cwd: root, stdout: () => undefined, stderr: () => undefined },
      {
        executeManagedDeliberation: async (input) => {
          request = input;
          throw Object.assign(new Error("stop after parse"), { code: "fixture_stop" });
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(request).toEqual({
      repositoryRoot: root,
      proposerProvider: "claude",
      reviewerProvider: "codex",
      verificationSuiteIds: ["repository.default"],
      topic: "Review the proposed UX writing change.",
    });
  });

  it("requires two different providers before starting a deliberation", async () => {
    let called = false;
    let errors = "";
    const exitCode = await runCli(
      [
        "deliberate",
        "--proposer",
        "codex",
        "--reviewer",
        "codex",
        "--verification",
        "project.default",
        "topic",
      ],
      {
        cwd: process.cwd(),
        stdout: () => undefined,
        stderr: (message) => {
          errors += message;
        },
      },
      {
        executeManagedDeliberation: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errors).toContain("Provide one resume ID");
  });

  it("accepts a stored policy without inline role arguments", async () => {
    let request: unknown;
    const exitCode = await runCli(
      ["deliberate", "--policy", "deliberation_product-review", "review topic"],
      {
        cwd: "/work/repository",
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        executeManagedDeliberation: async (input) => {
          request = input;
          throw Object.assign(new Error("stop after parse"), { code: "fixture_stop" });
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(request).toEqual({
      repositoryRoot: "/work/repository",
      policyId: "deliberation_product-review",
      topic: "review topic",
    });
  });

  it("runs an assigned queue deliberation with exact IDs and stdin-only topic bytes", async () => {
    let assignment: unknown;
    let output = "";
    const exitCode = await runCli(
      [
        "deliberate",
        "assigned-worker",
        "--deliberation-id",
        "dlb_queue0001",
        "--project-id",
        "prj_control01",
        "--root",
        "/work/repository",
        "--codex-executable",
        "/opt/providers/codex",
        "--claude-executable",
        "/opt/providers/claude",
        "--codex-model",
        "gpt-test",
        "--claude-model",
        "claude-test",
        "--codex-reasoning-effort",
        "high",
        "--claude-reasoning-effort",
        "medium",
        "--stdin",
      ],
      {
        cwd: "/ignored",
        stdout: (message) => {
          output += message;
        },
        stderr: () => undefined,
        stdin: async () =>
          JSON.stringify({
            operation: "start",
            policyId: "deliberation_product-review",
            topic: "Review the deployment boundary.",
            origin: {
              sourceEventId: `cve_${"a".repeat(64)}`,
              conversationId: "cnv_control01",
              threadId: null,
              requesterParticipantId: "ptc_control01",
              originBindingDigest: `sha256:${"d".repeat(64)}`,
            },
          }),
      },
      {
        executeAssignedManagedDeliberation: async (input) => {
          assignment = input;
          return {
            deliberationId: input.deliberationId,
            status: "converged",
            artifactCount: 4,
          } as ManagedDeliberationOutcome;
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(assignment).toEqual({
      deliberationId: "dlb_queue0001",
      expectedProjectId: "prj_control01",
      origin: {
        sourceEventId: `cve_${"a".repeat(64)}`,
        conversationId: "cnv_control01",
        threadId: null,
        requesterParticipantId: "ptc_control01",
        originBindingDigest: `sha256:${"d".repeat(64)}`,
      },
      request: {
        repositoryRoot: "/work/repository",
        policyId: "deliberation_product-review",
        topic: "Review the deployment boundary.",
        responseLanguage: "en",
        providerExecutables: {
          codex: "/opt/providers/codex",
          claude: "/opt/providers/claude",
        },
        providerModels: { codex: "gpt-test", claude: "claude-test" },
        providerReasoningEfforts: { codex: "high", claude: "medium" },
      },
    });
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      deliberationId: "dlb_queue0001",
      status: "converged",
      artifactCount: 4,
      failureReasonCode: null,
    });
  });

  it("does not mix a stored policy with inline providers", async () => {
    let called = false;
    const exitCode = await runCli(
      [
        "deliberate",
        "--policy",
        "deliberation_product-review",
        "--proposer",
        "codex",
        "review topic",
      ],
      { cwd: process.cwd(), stdout: () => undefined, stderr: () => undefined },
      {
        executeManagedDeliberation: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(called).toBe(false);
  });

  it("accepts a resume ID without a topic or role arguments", async () => {
    let request: unknown;
    const exitCode = await runCli(
      ["deliberate", "--resume", "dlb_12345678"],
      { cwd: "/work/repository", stdout: () => undefined, stderr: () => undefined },
      {
        executeManagedDeliberation: async (input) => {
          request = input;
          throw Object.assign(new Error("stop after parse"), { code: "fixture_stop" });
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(request).toEqual({
      repositoryRoot: "/work/repository",
      resumeDeliberationId: "dlb_12345678",
    });
  });

  it("prints a converged result without exposing evidence digests", async () => {
    let output = "";
    const outcome: ManagedDeliberationOutcome = {
      deliberationId: "dlb_cli_result_0001",
      status: "converged",
      artifactCount: 4,
      finalContent: "A conclusion reached through independent review and actual verification.",
      providers: { proposer: "codex", reviewer: "claude" },
      participants: [
        {
          roleId: "deliberation-proposer",
          name: "Proposal and decision role",
          provider: "codex",
          responsibilities: ["proposer", "decision_owner"],
        },
        {
          roleId: "deliberation-reviewer",
          name: "Independent review and verification role",
          provider: "claude",
          responsibilities: ["reviewer", "verifier"],
        },
      ],
      outcome: {
        schemaVersion: 1,
        outcomeId: "dlo_0000000000000001",
        deliberationId: "dlb_cli_result_0001",
        projectId: "prj_cli_result_0001",
        policyId: "deliberation_cli.two-provider-v1",
        policyHash: `sha256:${"1".repeat(64)}`,
        status: "converged",
        lastRound: 1,
        artifactIds: ["dla_0000000000000001"],
        lastConfirmedArtifactId: "dla_0000000000000001",
        decisionArtifactId: "dla_0000000000000001",
        passedVerificationArtifactIds: ["dla_0000000000000002"],
        unresolvedBlockingObjectionIds: [],
        noConsensusReason: null,
        failure: null,
        completedAt: "2026-08-21T00:00:00.000Z",
      },
    };
    const exitCode = await runCli(
      [
        "deliberate",
        "--proposer",
        "codex",
        "--reviewer",
        "claude",
        "--verification",
        "project.default",
        "topic to review",
      ],
      {
        cwd: process.cwd(),
        stdout: (message) => {
          output += message;
        },
        stderr: () => undefined,
      },
      { executeManagedDeliberation: async () => outcome },
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("Deliberation reached a decision");
    expect(output).toContain(outcome.finalContent);
    expect(output).not.toContain("sha256:");
    expect(output).not.toContain("dlb_cli_result_0001");
  });
});

describe("lervo trace CLI", () => {
  it("reports machine-readable capabilities without opening project storage", async () => {
    let output = "";
    let errors = "";
    let storageOpened = false;
    const exitCode = await runCli(
      ["trace", "--capabilities"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          errors += message;
        },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(storageOpened).toBe(false);
    expect(errors).toBe("");
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      capability: "trace",
      eventReader: {
        schemaVersion: 1,
        capability: "event_reader",
        readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8],
      },
      defaultMode: "page",
      limits: {
        defaultPageSize: 50,
        maximumPageSize: 100,
        maximumFullEventCount: 1000,
        maximumCursorBytes: 2048,
      },
      deprecations: [],
    });

    let explicitJsonOutput = "";
    expect(
      await runCli(
        ["trace", "--capabilities", "--json"],
        {
          cwd: "/missing/repository/is-not-required",
          stdout: (message) => {
            explicitJsonOutput += message;
          },
          stderr: (message) => {
            errors += message;
          },
        },
        {
          openProjectStorage: async () => {
            storageOpened = true;
            throw new Error("storage must not open");
          },
        },
      ),
    ).toBe(0);
    expect(JSON.parse(explicitJsonOutput)).toEqual(JSON.parse(output));
    expect(storageOpened).toBe(false);
    expect(errors).toBe("");
  });

  it("traces the latest run from append-only local events", async () => {
    const root = await temporaryRepository();
    expect(
      await runCli(["init"], {
        cwd: root,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    ).toBe(0);
    const storage = await openProjectStorage(root);
    const common = {
      projectId: storage.manifest.projectId,
      runId: "run_cli_trace_0001",
      sessionId: "ses_cli_trace_0001",
      actor: { kind: "system" as const },
      schemaVersion: 1 as const,
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_start",
      type: "run.requested",
      occurredAt: "2026-08-19T00:00:00Z",
      payload: {
        requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        role: "developer",
        risk: "low",
      },
    });
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_done",
      type: "run.completed",
      occurredAt: "2026-08-19T00:00:01Z",
      payload: {
        resultDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        artifactIds: ["art_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
        verificationStatus: "not_run",
      },
    });
    await storage.close();

    let output = "";
    let defaultErrors = "";
    const code = await runCli(["trace", "last"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: (message) => {
        defaultErrors += message;
      },
    });

    expect(code).toBe(0);
    expect(output).toContain("Run trace page: run_cli_trace_0001");
    expect(output).toContain("run.requested");
    expect(output).toContain("run.completed");
    expect(output).not.toContain("source claim");
    expect(defaultErrors).toBe("");

    let jsonOutput = "";
    let jsonErrors = "";
    expect(
      await runCli(["trace", "last", "--json"], {
        cwd: root,
        stdout: (message) => {
          jsonOutput += message;
        },
        stderr: (message) => {
          jsonErrors += message;
        },
      }),
    ).toBe(0);
    expect(JSON.parse(jsonOutput)).toMatchObject({
      schemaVersion: 1,
      runId: "run_cli_trace_0001",
      page: { returnedCount: 2, hasMore: false },
    });
    expect(JSON.parse(jsonOutput)).not.toHaveProperty("status");
    expect(jsonErrors).toBe("");

    let explicitFullOutput = "";
    let explicitFullErrors = "";
    expect(
      await runCli(["trace", "last", "--full", "--json"], {
        cwd: root,
        stdout: (message) => {
          explicitFullOutput += message;
        },
        stderr: (message) => {
          explicitFullErrors += message;
        },
      }),
    ).toBe(0);
    expect(JSON.parse(explicitFullOutput)).toMatchObject({
      schemaVersion: 1,
      runId: "run_cli_trace_0001",
      status: "completed",
    });
    expect(JSON.parse(explicitFullOutput).events).toEqual(JSON.parse(jsonOutput).events);
    expect(explicitFullErrors).toBe("");

    let firstPageOutput = "";
    let firstPageErrors = "";
    expect(
      await runCli(["trace", "last", "--page-size", "1", "--json"], {
        cwd: root,
        stdout: (message) => {
          firstPageOutput += message;
        },
        stderr: (message) => {
          firstPageErrors += message;
        },
      }),
    ).toBe(0);
    const firstPage = JSON.parse(firstPageOutput);
    expect(firstPage.events.map((event: { seq: number }) => event.seq)).toEqual([1]);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPageErrors).toBe("");

    let secondPageOutput = "";
    expect(
      await runCli(["trace", "--cursor", firstPage.page.nextCursor, "--json"], {
        cwd: root,
        stdout: (message) => {
          secondPageOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    const secondPage = JSON.parse(secondPageOutput);
    expect(secondPage.events.map((event: { seq: number }) => event.seq)).toEqual([2]);
    expect(secondPage.page.hasMore).toBe(false);

    let filteredOutput = "";
    expect(
      await runCli(["trace", "last", "--event-type", "run.completed", "--json"], {
        cwd: root,
        stdout: (message) => {
          filteredOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    const filtered = JSON.parse(filteredOutput);
    expect(filtered.filter).toEqual({ eventTypes: ["run.completed"] });
    expect(filtered.events.map((event: { seq: number }) => event.seq)).toEqual([2]);
  });
});
