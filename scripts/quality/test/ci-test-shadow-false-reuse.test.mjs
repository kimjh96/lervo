import {
  chmodSync,
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCiTestInputSnapshot } from "../lib/ci-test-shadow-inputs.mjs";
import { computeCiTestToolchainDigest } from "../lib/ci-test-toolchain-digest.mjs";
import { components, createShadowHarness, G } from "./fixtures/ci-test-shadow-harness.mjs";

// Property matrix (ADR-0565, Stage 2): every cell changes one input that a test of that kind
// observes, and the predictor must say rerun. A cell that the kind cannot observe is listed with
// its reason and must stay reusable, so the matrix also guards against hiding real reuse.
let shadow;
const at = (path) => resolve(shadow.root, path);
const replaceWithDirectory = (path) => {
  rmSync(at(path), { recursive: true, force: true });
  mkdirSync(at(path));
};
const relink = (path, target) => {
  rmSync(at(path), { recursive: true, force: true });
  symlinkSync(target, at(path));
};

beforeEach(() => {
  shadow = createShadowHarness();
  shadow.write("k/x.txt", "a");
  shadow.write("k/target.txt", "t");
  shadow.write("k/other.txt", "t");
  shadow.write("k/same.txt", "a");
  shadow.write("k/sub/y.txt", "y");
  symlinkSync("target.txt", at("k/link"));
  for (const path of ["k/x.txt", "k/target.txt", "k/other.txt", "k/same.txt", "k/sub/y.txt"])
    chmodSync(at(path), 0o644);
});
afterEach(() => shadow.remove());

const kinds = {
  file: {
    record: { inputs: ["k/x.txt"] },
    content: () => shadow.write("k/x.txt", "b"),
    type: () => replaceWithDirectory("k/x.txt"),
    mode: () => chmodSync(at("k/x.txt"), 0o664),
    rename: () => renameSync(at("k/x.txt"), at("k/w.txt")),
    create: () => shadow.write("k/x.js", "a"),
    delete: () => unlinkSync(at("k/x.txt")),
    retarget: () => relink("k/x.txt", "same.txt"),
  },
  symlink: {
    record: { inputs: ["k/link"] },
    content: () => shadow.write("k/target.txt", "u"),
    type: () => {
      unlinkSync(at("k/link"));
      shadow.write("k/link", "t");
    },
    mode: () => chmodSync(at("k/target.txt"), 0o600),
    rename: () => renameSync(at("k/target.txt"), at("k/t2.txt")),
    create: () => shadow.write("k/link.ts", ""),
    delete: () => unlinkSync(at("k/link")),
    retarget: () => relink("k/link", "other.txt"),
  },
  tree: {
    record: { trees: ["k"] },
    content: () => shadow.write("k/sub/y.txt", "z"),
    type: () => replaceWithDirectory("k/sub/y.txt"),
    mode: () => chmodSync(at("k/sub/y.txt"), 0o600),
    rename: () => renameSync(at("k/sub/y.txt"), at("k/sub/z.txt")),
    create: () => shadow.write("k/sub/new.txt", ""),
    delete: () => unlinkSync(at("k/sub/y.txt")),
    retarget: () => relink("k/link", "other.txt"),
  },
  "plain listing": {
    record: { listings: [["k", "plain"]] },
    type: () => replaceWithDirectory("k/x.txt"),
    rename: () => renameSync(at("k/x.txt"), at("k/w.txt")),
    create: () => shadow.write("k/new.txt", ""),
    delete: () => unlinkSync(at("k/x.txt")),
    retarget: () => relink("k/x.txt", "same.txt"),
    unobservable: {
      content: ["a listing holds names and types", () => shadow.write("k/x.txt", "b")],
      mode: ["a listing has no mode", () => chmodSync(at("k/x.txt"), 0o600)],
    },
  },
  "recursive listing": {
    record: { listings: [["k", "recursive"]] },
    type: () => replaceWithDirectory("k/sub/y.txt"),
    rename: () => renameSync(at("k/sub/y.txt"), at("k/sub/z.txt")),
    create: () => shadow.write("k/sub/new.txt", ""),
    delete: () => unlinkSync(at("k/sub/y.txt")),
    retarget: () => relink("k/sub/y.txt", "../same.txt"),
    unobservable: {
      content: ["a listing holds names and types", () => shadow.write("k/sub/y.txt", "z")],
      mode: ["a listing has no mode", () => chmodSync(at("k/sub/y.txt"), 0o600)],
    },
  },
  "absent path": {
    record: { absent: ["k/missing"] },
    type: () => mkdirSync(at("k/missing")),
    rename: () => renameSync(at("k/other.txt"), at("k/missing")),
    create: () => shadow.write("k/missing", ""),
    retarget: () => symlinkSync("target.txt", at("k/missing")),
    unobservable: {
      content: ["an absent path has no content", () => shadow.write("k/x.txt", "b")],
      mode: ["an absent path has no mode", () => chmodSync(at("k/x.txt"), 0o600)],
      delete: ["an absent path cannot be deleted", () => unlinkSync(at("k/x.txt"))],
    },
  },
  metadata: {
    record: { inputs: ["k/sub"] },
    type: () => {
      rmSync(at("k/sub"), { recursive: true });
      shadow.write("k/sub", "y");
    },
    mode: () => chmodSync(at("k/sub"), 0o700),
    rename: () => renameSync(at("k/sub"), at("k/sub2")),
    create: () => shadow.write("k/sub.js", ""),
    delete: () => rmSync(at("k/sub"), { recursive: true }),
    retarget: () => relink("k/sub", "."),
    unobservable: {
      content: [
        "a directory's metadata does not include its entries' bytes",
        () => shadow.write("k/sub/y.txt", "z"),
      ],
    },
  },
};
const mutations = ["content", "type", "mode", "rename", "create", "delete", "retarget"];

describe.each(Object.entries(kinds))("a %s input", (_kind, definition) => {
  const history = () => [shadow.historyRun({ files: [shadow.record(definition.record)] })];

  it("is reusable while nothing changes", () => {
    expect(shadow.predict(history()).reuse).toBe(true);
  });

  it.each(mutations.filter((mutation) => definition[mutation]))(
    "reruns after a %s change",
    (mutation) => {
      const recorded = history();
      definition[mutation]();
      expect(shadow.predict(recorded).reuse).toBe(false);
    },
  );

  it.each(
    Object.entries(definition.unobservable ?? {}).map(([mutation, [reason, change]]) => [
      mutation,
      reason,
      change,
    ]),
  )(
    "stays reusable after a %s change, which it cannot observe: %s",
    (_mutation, _reason, change) => {
      const recorded = history();
      change();
      expect(shadow.predict(recorded).reuse).toBe(true);
    },
  );

  it("covers every mutation either as a rerun or as unobservable", () => {
    for (const mutation of mutations)
      expect(Boolean(definition[mutation]) || mutation in (definition.unobservable ?? {})).toBe(
        true,
      );
  });
});

describe("environment and toolchain inputs", () => {
  /** G of a minimal repository, so the environment and file components can be varied. */
  const digest = async (environment, files = {}) => {
    const tracked = {
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "package.json": "{}",
      "tsconfig.json": "{}",
      ".github/workflows/code-quality.yml": "jobs:\n  test:\n    steps: []\n",
      ...files,
    };
    for (const [path, content] of Object.entries(tracked))
      if (content !== null) shadow.write(path, content);
    const paths = Object.entries(tracked)
      .filter(([, content]) => content !== null)
      .map(([path]) => path);
    return (
      await computeCiTestToolchainDigest({
        repositoryRoot: shadow.root,
        tracked: paths,
        setupFiles: [],
        environment,
      })
    ).digest;
  };
  const base = { PATH: "/usr/bin", NODE_OPTIONS: "", GITHUB_REF: "refs/heads/main" };
  const reused = async (recorded, current) =>
    shadow.predict([shadow.historyRun({ files: [shadow.record({ toolchainDigest: recorded })] })], {
      toolchain: { digest: current, components },
    }).reuse;

  it.each([
    ["content", { ...base, NODE_OPTIONS: "--conditions=development" }],
    ["create", { ...base, EXTRA: "1" }],
    ["delete", { PATH: "/usr/bin", NODE_OPTIONS: "" }],
    ["rename", { PATH: "/usr/bin", NODE_OPTIONS: "", GITHUB_REF_X: "refs/heads/main" }],
    ["ref", { ...base, GITHUB_REF: "refs/heads/feature" }],
  ])("reruns after an environment %s change", async (_mutation, environment) => {
    expect(await reused(await digest(base), await digest(base))).toBe(true);
    expect(await reused(await digest(base), await digest(environment))).toBe(false);
  });

  it("keeps a run-unique variable out of G", async () => {
    expect(await digest({ ...base, GITHUB_RUN_ID: "1" })).toBe(
      await digest({ ...base, GITHUB_RUN_ID: "2" }),
    );
  });

  it.each([
    ["content", { "pnpm-lock.yaml": "lockfileVersion: '9.1'\n" }],
    ["create", { "packages/cas/dist/native/cas.node": "binary" }],
    ["rename", { "tsconfig.json": null, "tsconfig.base.json": "{}" }],
  ])("reruns after a toolchain %s change", async (_mutation, files) => {
    const recorded = await digest(base);
    expect(await reused(recorded, await digest(base, files))).toBe(false);
  });

  it("reruns after a toolchain type or delete change", async () => {
    const recorded = await digest(base, { "packages/cas/dist/native/cas.node": "binary" });
    rmSync(at("packages/cas/dist/native/cas.node"));
    expect(await reused(recorded, await digest(base))).toBe(false);
    mkdirSync(at("packages/cas/dist/native/cas.node"));
    shadow.write("packages/cas/dist/native/cas.node/inner", "binary");
    expect(await reused(recorded, await digest(base))).toBe(false);
  });
});

// Each regression reproduces one defect the adversarial review of 2026-11-15 demonstrated.
describe("review regressions", () => {
  it("r1: a link whose target cannot be digested is never reusable", () => {
    const descriptor = openSync(at("k/large"), "w+");
    ftruncateSync(descriptor, 513 * 1024 * 1024);
    writeSync(descriptor, Buffer.from("P"), 0, 1, 0);
    closeSync(descriptor);
    symlinkSync("large", at("k/input"));
    const history = [shadow.historyRun({ files: [shadow.record({ inputs: ["k/input"] })] })];
    expect(history[0].index.inputs.get("k/input").resolved.kind).toBe("unknown");
    expect(shadow.predict(history)).toMatchObject({ reason: "input_unverifiable" });
  });

  it("r2: a copied link to a directory compares the directory it copies", () => {
    shadow.write("target/x", "pass");
    symlinkSync("target", at("linked"));
    const history = [shadow.historyRun({ files: [shadow.record({ trees: ["linked"] })] })];
    expect(shadow.predict(history).reuse).toBe(true);
    shadow.write("target/x", "fail");
    expect(shadow.predict(history)).toMatchObject({ reason: "tree_changed", detail: "linked" });
  });

  it("r7: a file replaced by a link with the same name changes the listing", () => {
    const history = [shadow.historyRun({ files: [shadow.record({ listings: [["k", "plain"]] })] })];
    relink("k/x.txt", "same.txt");
    expect(shadow.predict(history)).toMatchObject({ reason: "listing_changed", detail: "k" });
  });

  it("r8: listing names that join to the same text, or look like the kind, never collide", () => {
    shadow.write("d/a\nb", "");
    const joined = [shadow.historyRun({ files: [shadow.record({ listings: [["d", "plain"]] })] })];
    unlinkSync(at("d/a\nb"));
    shadow.write("d/a", "");
    shadow.write("d/b", "");
    expect(shadow.predict(joined)).toMatchObject({ reason: "listing_changed" });

    shadow.write("e/recursive", "");
    shadow.write("e/x", "");
    shadow.write("f/x", "");
    const snapshot = createCiTestInputSnapshot(shadow.root);
    expect(snapshot.listing("e", false)).not.toBe(snapshot.listing("f", true));
    const plain = [shadow.historyRun({ files: [shadow.record({ listings: [["e", "plain"]] })] })];
    unlinkSync(at("e/recursive"));
    expect(shadow.predict(plain)).toMatchObject({ reason: "listing_changed", detail: "e" });
  });

  it("r9: a group or world permission change is a changed input", () => {
    const history = [shadow.historyRun({ files: [shadow.record({ inputs: ["k/x.txt"] })] })];
    chmodSync(at("k/x.txt"), 0o666);
    expect(shadow.predict(history)).toMatchObject({ reason: "input_changed", detail: "k/x.txt" });
  });

  it("r6: G follows the ref and NODE_OPTIONS", async () => {
    const compute = (environment) =>
      computeCiTestToolchainDigest({
        repositoryRoot: shadow.root,
        tracked: [],
        setupFiles: [],
        environment,
      });
    shadow.write(".github/workflows/code-quality.yml", "jobs: {}\n");
    shadow.write("pnpm-lock.yaml", "");
    const main = await compute({ GITHUB_REF: "refs/heads/main", NODE_OPTIONS: "" });
    const feature = await compute({
      GITHUB_REF: "refs/heads/feature",
      NODE_OPTIONS: "--conditions=development",
    });
    expect(feature.digest).not.toBe(main.digest);
    expect(G).not.toBe(main.digest);
  });
});
