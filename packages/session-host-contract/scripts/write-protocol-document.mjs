// Writes the protocols' JSON Schema documents for the Rust session host and the core-link request
// validator for the resident Lervo process. Contract tests fail when a committed output is stale.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { coreLinkProtocolDocument, sessionHostProtocolDocument } from "../dist/index.js";
import { compileCoreLinkValidator } from "./compile-core-link-validator.mjs";

const generated = resolve(import.meta.dirname, "../generated");
for (const [name, document] of [
  ["session-host-protocol", sessionHostProtocolDocument()],
  ["core-link-protocol", coreLinkProtocolDocument()],
]) {
  await writeFile(
    resolve(generated, `${name}.schema.json`),
    `${JSON.stringify(document, null, 2)}\n`,
  );
}
await writeFile(
  resolve(generated, "core-link-request-validator.js"),
  await compileCoreLinkValidator(coreLinkProtocolDocument()),
);
