// Writes the protocol's JSON Schema document for the Rust session host. The contract test fails
// when the committed document differs from what the TypeScript schemas produce.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sessionHostProtocolDocument } from "../dist/index.js";

const target = resolve(import.meta.dirname, "../generated/session-host-protocol.schema.json");
await writeFile(target, `${JSON.stringify(sessionHostProtocolDocument(), null, 2)}\n`);
