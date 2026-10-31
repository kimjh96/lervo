import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInstalledCli } from "./installed-cli.mjs";

/** A fresh installed CLI must state what resolves a root document when no provider is given. */
export async function verifyInstalledDocumentDeferrals(cliEntry, fixtureRoot) {
  const root = resolve(fixtureRoot, "document-deferrals");
  await mkdir(root);
  await runInstalledCli(cliEntry, ["init"], root);
  await writeFile(resolve(root, "TRACE.md"), "# Trace\n\nInspect service traces.\n");
  const result = await runInstalledCli(cliEntry, ["migrate", "knowledge", "--json"], root);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.coverage.complete, false);
  assert.equal(plan.deferredDocumentCount, 1);
  assert.equal(plan.deferredDocuments[0].path, "TRACE.md");
  assert.equal(plan.deferredDocuments[0].resolution, "provider_unavailable");
  const text = await runInstalledCli(cliEntry, ["migrate", "knowledge"], root);
  assert.match(text.stdout, /^Deferred documents: 1\n/u);
  assert.match(text.stdout, /deferred \[provider_unavailable\] TRACE\.md/u);
}
