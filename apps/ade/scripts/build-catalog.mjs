// Compiles the message catalogs to ICU ASTs, so the interface ships no message parser. A test
// fails when a committed compiled catalog is stale.
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

/** Compiles `locale`'s catalog to `outFile`. */
export async function compileCatalog(locale, outFile) {
  await execute(resolve(root, "node_modules/.bin/formatjs"), [
    "compile",
    resolve(root, `src/i18n/messages.${locale}.json`),
    "--ast",
    "--out-file",
    outFile,
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`)
  await compileCatalog("en", resolve(root, "src/i18n/generated/en.json"));
