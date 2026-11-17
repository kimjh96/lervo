import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-layout-decision-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Example\n\nSee ARCHITECTURE.md.\n");
  await writeFile(resolve(root, "ARCHITECTURE.md"), "# Architecture\n\nRuntime design.\n");
  const messages: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (message: string) => messages.push(message),
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli(["init"], io)).toBe(0);
  const run = async (args: string[]) => {
    messages.length = 0;
    errors.length = 0;
    const code = await runCli(args, io);
    return { code, out: messages.join(""), err: errors.join("") };
  };
  return { root, run };
}

function decisionLines(out: string): { decisionId: string; accept: string; decline: string } {
  const decisionId = /Layout decision: (klaydec_[a-f0-9]{24})/u.exec(out)?.[1];
  const accept = /Accept: lervo (migrate knowledge --root \S+ --accept-layout \S+)/u.exec(out)?.[1];
  const decline = /Decline: lervo (migrate knowledge --root \S+ --decline-layout \S+)/u.exec(
    out,
  )?.[1];
  if (decisionId === undefined || accept === undefined || decline === undefined)
    throw new Error(`no layout decision in:\n${out}`);
  return { decisionId, accept, decline };
}

describe("repository layout decision (ADR-0559)", () => {
  it("asks one decision with a recommendation and applies every item on acceptance", async () => {
    const { root, run } = await repository();
    const planned = await run(["migrate", "knowledge"]);
    expect(planned.code).toBe(0);
    expect(planned.out).toContain("Recommendation: accept.");
    const decision = decisionLines(planned.out);

    const status = await run(["terminal", "status", "--json"]);
    expect(JSON.parse(status.out).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "repository_layout_decision_pending",
          command: expect.stringContaining(`--accept-layout ${decision.decisionId}=`),
        }),
      ]),
    );

    const accepted = await run([...decision.accept.split(" "), "--json"]);
    expect(accepted.code, accepted.err).toBe(0);
    expect(JSON.parse(accepted.out)).toMatchObject({ operation: "migrate", movedCount: 1 });
    await expect(access(resolve(root, "ARCHITECTURE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, "README.md"), "utf8")).toContain(
      "docs/architecture/system.md",
    );
  });

  it("grants nothing for a stale or combined decision", async () => {
    const { root, run } = await repository();
    const decision = decisionLines((await run(["migrate", "knowledge"])).out);
    const stale = await run([
      "migrate",
      "knowledge",
      "--accept-layout",
      `${decision.decisionId}=sha256:${"0".repeat(64)}`,
    ]);
    expect(stale.code).toBe(1);
    expect(stale.err).toContain("no longer matches the current plan");
    const combined = await run([...decision.accept.split(" "), "--apply", "klayout_x"]);
    expect(combined.code).toBe(1);
    expect(combined.err).toContain("replaces --apply and --approve-item");
    expect(await readFile(resolve(root, "ARCHITECTURE.md"), "utf8")).toContain("Runtime design.");
  });

  it("settles a declined decision until the plan changes", async () => {
    const { root, run } = await repository();
    const decision = decisionLines((await run(["migrate", "knowledge"])).out);
    const declined = await run(decision.decline.split(" "));
    expect(declined.code, declined.err).toBe(0);
    expect(declined.out).toContain(`Declined layout decision ${decision.decisionId}`);
    expect(await readFile(resolve(root, "ARCHITECTURE.md"), "utf8")).toContain("Runtime design.");
    const status = await run(["terminal", "status", "--json"]);
    const declinedStatus = JSON.parse(status.out) as {
      issues: Array<{ code: string }>;
      knowledgeAdvisories?: Array<{ code: string }>;
    };
    const codes = declinedStatus.issues.map((issue) => issue.code);
    expect(codes).not.toContain("repository_layout_decision_pending");
    expect(codes).not.toContain("repository_layout_review_required");
    // The decline holds the later knowledge stages back, so it stays visible without asking.
    expect(declinedStatus.knowledgeAdvisories?.map((item) => item.code)).toContain(
      "repository_layout_decision_declined",
    );
    const upgrade = await run(["upgrade", "--json"]);
    expect(JSON.parse(upgrade.out).stages.knowledge).toMatchObject({
      disposition: "deferred",
      reason: "layout_decision_declined",
    });

    // A changed plan is a new decision and is asked again.
    await writeFile(resolve(root, "CONTRIBUTING.md"), "# Contributing\n\nOpen a pull request.\n");
    const changed = decisionLines((await run(["migrate", "knowledge"])).out);
    expect(changed.decisionId).not.toBe(decision.decisionId);
    const again = await run(["terminal", "status", "--json"]);
    expect(
      (JSON.parse(again.out).issues as Array<{ code: string }>).map((issue) => issue.code),
    ).toContain("repository_layout_decision_pending");
  });
});
