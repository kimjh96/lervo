// Writes the protocols' JSON Schema documents for the Rust session host. The contract test fails
// when the committed document differs from what the TypeScript schemas produce.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { coreLinkProtocolDocument, sessionHostProtocolDocument } from "../dist/index.js";

for (const [name, document] of [
  ["session-host-protocol", sessionHostProtocolDocument()],
  ["core-link-protocol", coreLinkProtocolDocument()],
]) {
  const target = resolve(import.meta.dirname, `../generated/${name}.schema.json`);
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
}
