import { createHash } from "node:crypto";
import { dirname } from "node:path";

import { CLI_DIST_FILES } from "./cli-install-pointer.js";

/**
 * ADR-0488: plans the rewrite of version-specific executable paths in one Node configuration's
 * raw JSON. It reads no file; the caller supplies the bytes and the host's stable pointers.
 *
 * - A CLI install path is `<root>/dist/<published file>`, where `<root>` is a CLI field's install,
 *   an `@lervo/cli` package under `node_modules`, or a sibling of one in the same install parent.
 *   It becomes `<cli pointer>/dist/<file>`.
 * - A Node runtime path is `<runtimes>/<hash16>/...` and becomes `<runtimes>/current/...` once the
 *   ADR-0483 pointer exists; until then it is retained and reported.
 * - Any other value in a CLI field is an explicit override: kept, and reported.
 */
export interface NodeConfigExecutableRewrite {
  field: string;
  kind: "cli_install" | "node_runtime";
  from: string;
  to: string;
}

export interface NodeConfigExecutableMigrationPlan {
  status: "current" | "migrate" | "invalid";
  sourceHash: string;
  migratedHash: string | null;
  migratedContent: string | null;
  rewrites: NodeConfigExecutableRewrite[];
  /** CLI fields whose value is not a recognizable CLI install path. */
  overrideFields: string[];
  /** Node runtime pins kept because the host has no `current` Node runtime pointer yet. */
  retainedFields: string[];
}

export interface NodeConfigExecutableMigrationInput {
  content: string;
  /** `<cli>/current`, the stable stand-in for the installed CLI package root. */
  cliPointerRoot: string;
  /** The physical package root of the running CLI, or null when it is not an installed build. */
  runningInstallRoot: string | null;
  nodeRuntimesDirectory: string;
  nodeRuntimePointerPresent: boolean;
}

/** The fields that by contract name the Lervo CLI bundle, in any conversation deployment. */
const CLI_FIELD =
  /\.deliberation\.cliExecutable$|^outcomeSupervision\.managedExecution\.cliBundle$/u;
const PACKAGE_SUFFIX = "/node_modules/@lervo/cli";
const BIN_SUFFIX = "/dist/bin.js";
const RUNTIME_DIRECTORY = /^([a-f0-9]{16})(\/.*)?$/u;

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface StringLeaf {
  field: string;
  value: string;
  replace(value: string): void;
}

function stringLeaves(value: unknown, field: string, leaves: StringLeaf[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const path = `${field}[${index}]`;
      if (typeof item === "string")
        leaves.push({ field: path, value: item, replace: (next) => (value[index] = next) });
      else stringLeaves(item, path, leaves);
    });
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    const path = field.length === 0 ? key : `${field}.${key}`;
    if (typeof item === "string")
      leaves.push({ field: path, value: item, replace: (next) => (record[key] = next) });
    else stringLeaves(item, path, leaves);
  }
}

function distFile(value: string): { root: string; file: string } | null {
  const marker = value.lastIndexOf("/dist/");
  if (marker <= 0) return null;
  const file = value.slice(marker + "/dist/".length);
  return (CLI_DIST_FILES as readonly string[]).includes(file)
    ? { root: value.slice(0, marker), file }
    : null;
}

/** The directory that holds one labelled install, such as `~/.local/lib/lervo-cli`. */
function installParent(root: string): string | null {
  return root.endsWith(PACKAGE_SUFFIX) ? dirname(root.slice(0, -PACKAGE_SUFFIX.length)) : null;
}

export function planNodeConfigExecutableMigration(
  input: NodeConfigExecutableMigrationInput,
): NodeConfigExecutableMigrationPlan {
  const sourceHash = sha256(input.content);
  const empty = { migratedHash: null, migratedContent: null, rewrites: [] };
  let document: unknown;
  try {
    document = JSON.parse(input.content);
  } catch {
    document = null;
  }
  if (document === null || typeof document !== "object" || Array.isArray(document))
    return { status: "invalid", sourceHash, ...empty, overrideFields: [], retainedFields: [] };
  const leaves: StringLeaf[] = [];
  stringLeaves(document, "", leaves);

  const roots = new Set<string>();
  const parents = new Set<string>();
  const learn = (root: string) => {
    if (root === input.cliPointerRoot) return;
    roots.add(root);
    const parent = installParent(root);
    if (parent !== null) parents.add(parent);
  };
  if (input.runningInstallRoot !== null) learn(input.runningInstallRoot);
  for (const leaf of leaves) {
    const located = distFile(leaf.value);
    if (located === null) continue;
    if (located.root.endsWith(PACKAGE_SUFFIX)) learn(located.root);
    else if (CLI_FIELD.test(leaf.field) && leaf.value.endsWith(BIN_SUFFIX)) learn(located.root);
  }
  const cliInstall = (root: string): boolean =>
    root !== input.cliPointerRoot &&
    (roots.has(root) || parents.has(dirname(root)) || parents.has(installParent(root) ?? ""));

  const rewrites: NodeConfigExecutableRewrite[] = [];
  const overrideFields: string[] = [];
  const retainedFields: string[] = [];
  const runtimes = `${input.nodeRuntimesDirectory}/`;
  for (const leaf of leaves) {
    const located = distFile(leaf.value);
    if (located !== null && cliInstall(located.root)) {
      rewrites.push({
        field: leaf.field,
        kind: "cli_install",
        from: leaf.value,
        to: `${input.cliPointerRoot}/dist/${located.file}`,
      });
      continue;
    }
    const runtime = leaf.value.startsWith(runtimes)
      ? RUNTIME_DIRECTORY.exec(leaf.value.slice(runtimes.length))
      : null;
    if (runtime !== null) {
      if (input.nodeRuntimePointerPresent)
        rewrites.push({
          field: leaf.field,
          kind: "node_runtime",
          from: leaf.value,
          to: `${runtimes}current${runtime[2] ?? ""}`,
        });
      else retainedFields.push(leaf.field);
      continue;
    }
    if (CLI_FIELD.test(leaf.field) && !leaf.value.startsWith(`${input.cliPointerRoot}/`))
      overrideFields.push(leaf.field);
  }
  if (rewrites.length === 0)
    return { status: "current", sourceHash, ...empty, overrideFields, retainedFields };
  const byField = new Map(leaves.map((leaf) => [leaf.field, leaf]));
  for (const rewrite of rewrites) byField.get(rewrite.field)!.replace(rewrite.to);
  const migratedContent = `${JSON.stringify(document, null, 2)}\n`;
  return {
    status: "migrate",
    sourceHash,
    migratedHash: sha256(migratedContent),
    migratedContent,
    rewrites,
    overrideFields,
    retainedFields,
  };
}
