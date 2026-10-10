import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const smoke = `
const { open } = require("node:fs/promises");
const { join } = require("node:path");
(async () => {
  const native = require(process.argv[1]);
  const root = process.argv[2];
  const temporary = join(root, "temporary");
  const prefix = join(root, "objects");
  const target = join(prefix, "object");
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile("native CAS smoke");
    await handle.sync();
  } finally { await handle.close(); }
  const [published] = await native.batch([[temporary, prefix, target]]);
  const [duplicate, read, missing] = await native.batch([
    [temporary, prefix, target], [target], [join(prefix, "missing")]
  ]);
  for (const item of [published, duplicate, read])
    if (item.status !== "complete" || !Buffer.isBuffer(item.bytes) ||
        item.bytes.toString() !== "native CAS smoke") throw Error("native_cas_content_changed");
  if (published.created !== true || duplicate.created !== false || read.created !== false ||
      missing.status !== "failed" || missing.code !== "system_error" ||
      missing.syscall !== "lstat" || missing.errno !== 2 || missing.pathIndex !== 0)
    throw Error("native_cas_result_invalid");
  process.stdout.write("native_cas_smoke_passed\\n");
})().catch(() => { process.exitCode = 1; });
`;

/** Execute only after source/archive validation on the declared Darwin target. */
export async function smokeNativeCas(directory) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-native-cas-smoke-"));
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--input-type=commonjs", "--eval", smoke, resolve(directory, "cas-io-darwin.node"), root],
      { timeout: 10000, maxBuffer: 16384 },
    );
    if (stdout !== "native_cas_smoke_passed\n" || stderr !== "")
      throw new Error("native_cas_smoke_failed");
    return "native";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
