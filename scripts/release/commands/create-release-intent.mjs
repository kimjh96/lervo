import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createReleaseIntent } from "../lib/release-intent.mjs";

try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      impact: { type: "string" },
      summary: { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const result = await createReleaseIntent(resolve(parsed.values.root ?? "."), {
    impact: parsed.values.impact,
    summary: parsed.values.summary,
  });
  process.stdout.write(
    parsed.values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Release intent ${result.intent.intentId} ${result.created ? "created" : "already current"}.\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
