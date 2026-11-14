import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs, {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

// Exercises every observation surface of the CI test input recorder from a real process.
const root = resolve(import.meta.dirname, "../../../..");
const require = createRequire(import.meta.url);
const mode = process.argv[2];

async function observeEverything() {
  readFileSync(resolve(root, "package.json"));
  await readFile(resolve(root, "README.md"));
  readdirSync(resolve(root, "scripts/quality"));
  existsSync(resolve(root, "scripts/quality/absent-recorder-probe.mjs"));
  statSync(resolve(root, "docs"));
  await import("../../lib/generated-text.mjs");
  require("../../ci-test-durations.json");
  require("yaml");
  const scratch = mkdtempSync(resolve(tmpdir(), "lervo-recorder-program-"));
  writeFileSync(resolve(scratch, "note.txt"), "1");
  readFileSync(resolve(scratch, "note.txt"));
  existsSync(resolve(homedir(), ".lervo-ci-recorder-absent-probe"));
  Date.now();
  new Date();
  new Date(0);

  execFileSync(process.execPath, [import.meta.filename, "child"]);
  await new Promise((done) =>
    spawn(process.execPath, [import.meta.filename, "child"], { stdio: "ignore" }).on("exit", done),
  );
  spawnSync(process.execPath, [import.meta.filename, "child"], {
    env: { PATH: process.env.PATH },
  });
  execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  for (let index = 0; index < 3; index += 1) execFileSync("git", ["--version"], { cwd: scratch });
  spawnSync(resolve(scratch, "missing-executable"));

  const server = net.createServer((socket) => socket.end());
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await new Promise((done) =>
    net.connect(server.address().port, "127.0.0.1").on("close", done).on("error", done),
  );
  server.close();
  // TEST-NET-1 is never routed; the attempt is destroyed before it can leave the host.
  const external = net.connect({ host: "192.0.2.1", port: 9 });
  external.on("error", () => {});
  external.destroy();

  const { DatabaseSync } = require("node:sqlite");
  new DatabaseSync(":memory:").close();
  new DatabaseSync(resolve(scratch, "state.sqlite")).close();
  rmSync(scratch, { recursive: true, force: true });
}

/** Results and failures that must stay byte-identical with the recorder on. */
async function describeResults() {
  const missing = resolve(root, "scripts/quality/absent-recorder-probe.mjs");
  const code = (run) => {
    try {
      run();
      return "ok";
    } catch (error) {
      return error.code;
    }
  };
  const callback = (name, ...args) =>
    new Promise((done) => fs[name](...args, (error, value) => done(error?.code ?? value)));
  return {
    read: code(() => readFileSync(missing)),
    exists: existsSync(missing),
    stat: statSync(missing, { throwIfNoEntry: false }) === undefined,
    access: code(() => fs.accessSync(missing)),
    listing: readdirSync(resolve(root, "scripts/quality/lib")).sort(),
    typed: (await readdir(resolve(root, "scripts"), { withFileTypes: true })).map((entry) =>
      [entry.name, entry.isDirectory()].join(":"),
    ),
    rejected: await readFile(missing).catch((error) => error.code),
    stream: await new Promise((done) => {
      const chunks = [];
      fs.createReadStream(resolve(root, "pnpm-workspace.yaml"))
        .on("data", (chunk) => chunks.push(chunk))
        .on("end", () => done(Buffer.concat(chunks).length > 0));
    }),
    missingStream: await new Promise((done) =>
      fs.createReadStream(missing).on("error", (error) => done(error.code)),
    ),
    copied: code(() => fs.copyFileSync(missing, resolve(root, "never-written"))),
    callback: await callback("stat", missing),
    existsCallback: await new Promise((done) => fs.exists(missing, done)),
    date: new Date(0).toISOString() === "1970-01-01T00:00:00.000Z" && new Date() instanceof Date,
    constructor: new Date().constructor === Date,
  };
}

if (mode === "child") readFileSync(resolve(root, "pnpm-workspace.yaml"));
else if (mode === "wait") {
  readFileSync(resolve(root, "tsconfig.json"));
  process.stdout.write("ready\n");
  setInterval(() => {}, 1000);
} else if (mode === "results") process.stdout.write(`${JSON.stringify(await describeResults())}\n`);
else await observeEverything();
