import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

// Each row runs one program with the recorder off and on; everything the program prints, and how
// it exits, must be identical. A future transparency defect becomes one more row.
const recorder = resolve(import.meta.dirname, "../lib/ci-test-input-recorder.cjs");
const root = resolve(import.meta.dirname, "../../..");
let scratch;

beforeAll(async () => {
  scratch = await mkdtemp(resolve(tmpdir(), "lervo-ci-transparency-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function run(mode, code) {
  const {
    NODE_OPTIONS: _options,
    LERVO_CI_TEST_FILE: _file,
    LERVO_CI_TEST_LEDGER_DIRECTORY: _directory,
    ...rest
  } = process.env;
  const result = spawnSync(process.execPath, ["-e", code], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...rest,
      LERVO_CI_TEST_LEDGER: mode,
      LERVO_CI_TEST_LEDGER_DIRECTORY: resolve(scratch, "ledger"),
      NODE_OPTIONS: `--require=${JSON.stringify(recorder)}`,
    },
  });
  const normalize = (text) => text.replaceAll(/\(node:\d+\)/gu, "(node:PID)");
  return {
    status: result.status,
    signal: result.signal,
    stdout: normalize(result.stdout),
    stderr: normalize(result.stderr),
  };
}

/** Prints name, length, prototype and constructibility of each function, in order. */
const shapeOf = `const shape = (fn) => {
  let constructible = true;
  try { Reflect.construct(String, [], fn); } catch { constructible = false; }
  return [typeof fn, fn.name, fn.length, Object.hasOwn(fn, "prototype"), constructible].join(":");
};`;

const rows = [
  [
    "fs callback receives a thrown value whose code getter throws",
    `const sentinel = { get code() { throw Error("x"); } };
require("node:fs").cp("README.md", "/dev/null/out", { filter() { throw sentinel; } },
  (error) => console.log("callback", error === sentinel));`,
  ],
  [
    "spawnSync ignores a non-enumerable environment getter, as Node does",
    `const env = {}; Object.defineProperty(env, "NODE_OPTIONS", { get() { throw Error("x"); } });
const cp = require("node:child_process");
console.log(cp.spawnSync(process.execPath, ["-e", ""], { env }).status);
console.log(String(cp.execFileSync(process.execPath, ["-e", "process.stdout.write('ok')"], { env })));`,
  ],
  [
    "a small stack trace limit keeps the caller's frame",
    `const fs = require("node:fs"); Error.stackTraceLimit = 3;
function victim() { fs.readFileSync("missing"); }
try { victim(); } catch (error) { console.log(error.stack.includes("at victim")); }`,
  ],
  [
    "connect runs a port getter exactly as often as Node does",
    `let reads = 0; const socket = new (require("node:net").Socket)();
try { socket.connect({ get port() { return -++reads; } }); } catch (error) { console.log(error.message); }
socket.destroy();`,
  ],
  [
    "Date.now stays non-constructible with its name and length",
    `try { Reflect.construct(Date.now, []); console.log("constructed"); } catch (error) { console.log(error.name); }
console.log(Date.now.name, Date.now.length, Object.hasOwn(Date.now, "prototype"));`,
  ],
  [
    "a SQLite database keeps its constructor identity",
    `const { DatabaseSync } = require("node:sqlite"); const database = new DatabaseSync(":memory:");
console.log(database.constructor === DatabaseSync, database instanceof DatabaseSync); database.close();`,
  ],
  [
    "every wrapped function keeps its shape",
    `${shapeOf}
const fs = require("node:fs"); const cp = require("node:child_process"); const net = require("node:net");
const names = ["readFile", "open", "stat", "lstat", "exists", "access", "realpath", "readlink",
  "readdir", "opendir", "copyFile", "cp", "createReadStream"];
for (const name of names) console.log(name, shape(fs[name]), fs[name + "Sync"] && shape(fs[name + "Sync"]),
  fs.promises[name] && shape(fs.promises[name]));
console.log(shape(fs.realpathSync.native), shape(fs.realpath.native));
for (const name of ["spawnSync", "execFileSync", "execSync", "spawn", "execFile", "exec", "fork"])
  console.log(name, shape(cp[name]));
console.log(shape(cp.ChildProcess.prototype.spawn), shape(net.Socket.prototype.connect));
console.log(shape(process.dlopen), shape(Date), shape(Date.now), shape(require("node:module")._load));
console.log(Date.prototype.constructor === Date, new Date(0).constructor === Date);`,
  ],
  [
    "synchronous child APIs run option, argument and environment getters once",
    `const cp = require("node:child_process"); const reads = [];
const counted = (name, value) => ({ get() { reads.push(name); return value; }, enumerable: true });
const env = Object.defineProperties({}, { PATH: counted("PATH", process.env.PATH) });
const options = Object.defineProperties({}, { cwd: counted("cwd", "."), env: counted("env", env) });
const args = ["-e", ""]; Object.defineProperty(args, 1, counted("arg", ""));
cp.spawnSync(process.execPath, args, options);
cp.execFileSync(process.execPath, ["-e", ""], options);
cp.execSync("true", Object.defineProperties({}, { shell: counted("shell", "/bin/sh") }));
const text = { toString() { reads.push("toString"); return "-e"; } };
cp.spawnSync(process.execPath, [text, ""]);
console.log(reads.join(","));`,
  ],
  [
    "filesystem calls run option and URL getters once",
    `const fs = require("node:fs"); const reads = [];
fs.readdirSync(".", { get recursive() { reads.push("recursive"); return false; } });
class Counted extends URL { get href() { reads.push("href"); return super.href; } }
try { fs.readFileSync(new Counted("file:///missing-recorder-file")); } catch (error) { console.log(error.code); }
const traps = new Proxy(new URL("file:///missing-recorder-file"), {
  get(target, key) { reads.push(String(key)); const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
try { fs.statSync(traps); } catch (error) { console.log(error.code); }
console.log(reads.join(","));`,
  ],
  [
    "connect runs Proxy traps exactly as often as Node does",
    `const net = require("node:net"); const traps = [];
const options = new Proxy({ port: 9, host: "127.0.0.1" }, {
  get(target, key) { traps.push("get:" + String(key)); return Reflect.get(target, key); },
  getOwnPropertyDescriptor(target, key) { traps.push("own:" + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
const socket = net.connect(options); socket.on("error", () => {}); socket.destroy();
console.log(traps.join(","));`,
  ],
  [
    "a filesystem promise settles in the same microtask order",
    `const fs = require("node:fs"); const order = [];
fs.promises.stat(".").then(() => order.push("stat"));
let tick = 0; const step = () => { order.push("tick" + ++tick); if (tick < 40) return Promise.resolve().then(step); };
Promise.resolve().then(step);
setTimeout(() => console.log(order.indexOf("stat")), 50);`,
  ],
  [
    "an unhandled filesystem rejection still ends the process",
    `require("node:fs").promises.readFile("missing-recorder-file");`,
  ],
  [
    "a limit set during a synchronous call survives it",
    `const fs = require("node:fs");
fs.cpSync("README.md", "/dev/null/out", { filter() { Error.stackTraceLimit = 7; return false; } });
console.log(Error.stackTraceLimit);`,
  ],
  [
    "a user stack formatter keeps receiving the same call sites",
    `Error.prepareStackTrace = (error, sites) => sites.map((site) => site.getFunctionName()).filter((name) => name === "victim").length;
function victim() { require("node:fs").readFileSync("missing"); }
try { victim(); } catch (error) { console.log(error.stack); }`,
  ],
];

it.each(rows)("%s", (_, code) => {
  const off = run("off", code);
  expect(off.status, off.stderr).not.toBeNull();
  expect(run("on", code)).toEqual(off);
});

it("compares a running recorder with an inert one", () => {
  const code = `console.log(typeof globalThis[Symbol.for("lervo.ciTestInputRecorder")]);`;
  expect(run("off", code).stdout).toBe("undefined\n");
  expect(run("on", code).stdout).toBe("object\n");
});
