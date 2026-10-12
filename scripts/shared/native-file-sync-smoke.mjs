import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const smoke = `
const { open, readFile } = require("node:fs/promises");
const { join } = require("node:path");
(async () => {
  const native = require(process.argv[1]);
  const root = process.argv[2];
  const handles = [];
  try {
    for (let index = 0; index < 2; index++) {
      const handle = await open(join(root, String(index)), "wx");
      handles.push(handle);
      await handle.writeFile("durable " + index);
    }
    const grouped = await native.synchronize(handles.map(handle => handle.fd));
    if (grouped === false) await Promise.all(handles.map(handle => handle.sync()));
    else if (grouped !== true) throw Error("native_sync_invalid_result");
    for (let index = 0; index < 2; index++)
      if (await readFile(join(root, String(index)), "utf8") !== "durable " + index)
        throw Error("native_sync_content_changed");
    process.stdout.write(grouped ? "native_file_sync_smoke_passed\\n" : "native_file_sync_smoke_fallback\\n");
  } finally {
    await Promise.all(handles.map(handle => handle.close()));
  }
})().catch(() => { process.exitCode = 1; });
`;

/** Called only after archive/source identity validation, and only on the declared target host. */
export async function smokeNativeFileSync(directory) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-native-smoke-"));
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--input-type=commonjs", "--eval", smoke, resolve(directory, "file-sync-darwin.node"), root],
      { timeout: 10000, maxBuffer: 16384 },
    );
    if (
      !["native_file_sync_smoke_passed\n", "native_file_sync_smoke_fallback\n"].includes(stdout) ||
      stderr !== ""
    )
      throw new Error("native_file_sync_smoke_failed");
    return stdout === "native_file_sync_smoke_passed\n" ? "native" : "fallback";
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
