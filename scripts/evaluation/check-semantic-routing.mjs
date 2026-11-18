import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

const checks = [
  {
    path: "apps/cli/src/terminal-command-runtime.ts",
    forbidden: [
      "query: prompt",
      "mentions Codex-Claude deliberation",
      "explicitly requests or mentions",
    ],
  },
  {
    path: "apps/cli/src/run-capabilities.ts",
    forbidden: ["recommendations.map((item) => item.capabilityId)"],
  },
];

const violations = [];
for (const check of checks) {
  const content = await readFile(resolve(root, check.path), "utf8");
  for (const token of check.forbidden) {
    if (content.includes(token)) violations.push(`${check.path}: ${token}`);
  }
}

const retiredEvaluationRouters = [
  "grounding-resolver.mjs",
  "grounding-resolution.mjs",
  "grounding-policy.mjs",
  "grounding-prompt.mjs",
];
for (const name of retiredEvaluationRouters) {
  try {
    await readFile(resolve(root, "scripts/natural-language-evaluation", name), "utf8");
    violations.push(`scripts/natural-language-evaluation/${name}: legacy lexical router remains`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (violations.length > 0) {
  throw new Error(`Semantic routing audit failed:\n${violations.join("\n")}`);
}

console.log(
  "Semantic routing audit passed: zero known raw-language routing paths. Allowed lexical use is limited to capability/search candidate retrieval; allowed exact matching is limited to protocol IDs, schema enums, safe repository paths, and workstream continuation candidates.",
);
