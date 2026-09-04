import assert from "node:assert/strict";
import { resolve } from "node:path";

import * as prettier from "prettier";
import { describe, it } from "vitest";

import { formatFoundationEvidenceJson } from "../evidence/json-output.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const outputPath = resolve(repositoryRoot, "docs/evidence/foundation/adverse-condition-v1.json");

describe("foundation evidence JSON output", () => {
  it("emits repository-formatter-compliant bytes at the generation boundary", async () => {
    const value = {
      effects: [
        {
          effectId: "provider_start",
          growingCollectionIds: ["provider_sessions", "event_chain"],
        },
      ],
    };
    const naiveOutput = `${JSON.stringify(value, null, 2)}\n`;
    const output = await formatFoundationEvidenceJson(value, outputPath);
    const options = (await prettier.resolveConfig(outputPath)) ?? {};

    assert.notEqual(output, naiveOutput);
    assert.deepEqual(JSON.parse(output), value);
    assert.equal(output, await prettier.format(output, { ...options, filepath: outputPath }));
  });
});
