#!/usr/bin/env node
import { prepareBlindGroundTruthAuditPacket } from "../natural-language-evaluation/linked-evidence-provider-shadow-v9-ground-truth-audit-workspace.mjs";

const unknown = process.argv.slice(2).filter((argument) => !["--", "--write"].includes(argument));
if (unknown.length > 0) throw new TypeError(`Unknown arguments: ${unknown.join(", ")}`);

const result = await prepareBlindGroundTruthAuditPacket({
  repositoryRoot: process.cwd(),
  write: process.argv.includes("--write"),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
