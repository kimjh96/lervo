import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import ts from "typescript";
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
  [
    "a handled signal is not delivered again",
    `const { spawnSync } = require("node:child_process");
const code = \`process.prependOnceListener("SIGTERM", () => console.log("handled"));
process.kill(process.pid, "SIGTERM"); setTimeout(() => console.log("alive"), 50);\`;
const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
console.log(JSON.stringify({ stdout: result.stdout, status: result.status, signal: result.signal }));`,
  ],
  [
    "the recorder adds no process listeners",
    `const events = ["exit", "beforeExit", "SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT", "SIGUSR2",
  "uncaughtException", "unhandledRejection", "warning", "message", "disconnect"];
console.log(events.map((name) => name + "=" + process.listenerCount(name)).join(","));
console.log(process.eventNames().map(String).join(","));`,
  ],
  [
    "an explicit exit keeps its code",
    `process.on("exit", (code) => console.log("exit", code)); process.exit(3);`,
  ],
  ["an exit code set without exiting is kept", `process.exitCode = 4;`],
  ["an uncaught exception still ends the process", `throw new TypeError("boom");`],
  [
    "a Proxy over the global Error never sees recorder traps",
    `const fs = require("node:fs"); let traps = 0;
globalThis.Error = new Proxy(Error, { getOwnPropertyDescriptor() { traps++; throw "trap"; }, get(target, key) { traps++; return Reflect.get(target, key); } });
try { console.log("result", fs.existsSync("/dev/null"), Date.now() > 0, new Date() instanceof Date); } catch (error) { console.log("threw", error); }
console.log("traps", traps);`,
  ],
  [
    "a getter on Error.captureStackTrace is never read",
    `let reads = 0; const original = Error.captureStackTrace;
Object.defineProperty(Error, "captureStackTrace", { configurable: true, get() { reads++; return original; } });
Date.now(); new Date(); require("node:fs").existsSync("/dev/null"); console.log("reads", reads);`,
  ],
  [
    "replaced globals and process methods are not called by the recorder",
    `const fs = require("node:fs"); const calls = [];
const cwd = process.cwd; process.cwd = () => { calls.push("cwd"); return cwd(); };
for (const name of ["Object", "Reflect", "Array", "JSON", "String", "Set", "Map"]) {
  const value = globalThis[name];
  globalThis[name] = new Proxy(value, { get(target, key) { calls.push(name + "." + String(key)); return Reflect.get(target, key); },
    apply(target, self, args) { calls.push(name + "()"); return Reflect.apply(target, self, args); },
    construct(target, args, newTarget) { calls.push("new " + name); return Reflect.construct(target, args, newTarget); } });
}
fs.readFileSync("README.md"); fs.readdirSync("scripts"); fs.existsSync("missing-recorder-file");
require("node:child_process").spawnSync(process.execPath, ["-e", ""]);
for (const name of ["Object", "Reflect", "Array", "JSON", "String", "Set", "Map"]) globalThis[name] = undefined;
console.log(calls.length);`,
  ],
  [
    "child spawn reads environment pairs once",
    `const { ChildProcess } = require("node:child_process"); let reads = 0;
const envPairs = ["A=B"]; Object.defineProperty(envPairs, 0, { get() { reads++; return "A=B"; } });
const child = new ChildProcess();
child.spawn({ file: "/usr/bin/true", args: ["true"], envPairs, stdio: "ignore" });
child.on("close", (code) => console.log("exit", code, "reads", reads));`,
  ],
  [
    "an object constructed from a wrapped function names it as its constructor",
    `const fs = require("node:fs"); const net = require("node:net");
for (const fn of [fs.existsSync, fs.readFile, net.Socket.prototype.connect, process.dlopen]) {
  try { const value = Reflect.construct(fn, ["/dev/null"]); console.log(value instanceof fn, value.constructor === fn); }
  catch (error) { console.log(error.name); }
}`,
  ],
  [
    // CI on 2026-11-14: children that held an SQLite lock only through an unreachable object lost
    // it when the recorder's preload made a garbage collection come sooner. Garbage collection
    // timing is not observable behavior the recorder can preserve, so this row forces the
    // collection and requires the same outcome either way: only a reachable lock survives.
    "a garbage collection releases only a lock its holder no longer references",
    `const { spawn } = require("node:child_process"); const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync } = require("node:fs"); const { join } = require("node:path"); const { tmpdir } = require("node:os");
const holder = (keep) => \`import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.argv[1]);
db.exec("BEGIN IMMEDIATE"); process.stdout.write("locked");
setTimeout(() => { globalThis.gc(); setTimeout(() => process.stdout.write(" collected"), 50); }, 50);
setInterval(() => \${keep ? "db" : "{}"}, 1000);\`;
const check = async (keep) => {
  const path = join(mkdtempSync(join(tmpdir(), "lervo-gc-lock-")), "lock.sqlite");
  const child = spawn(process.execPath, ["--expose-gc", "--input-type=module", "-e", holder(keep), path], { stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; await new Promise((done) => child.stdout.on("data", (data) => { out += data; if (out.includes("collected")) done(); }));
  await new Promise((done) => setTimeout(done, 200));
  const database = new DatabaseSync(path, { timeout: 0 });
  let state = "released"; try { database.exec("BEGIN IMMEDIATE"); database.exec("ROLLBACK"); } catch { state = "held"; }
  database.close(); child.kill("SIGKILL"); return state;
};
(async () => console.log("unreachable", await check(false), "reachable", await check(true)))();`,
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

// Recorder hooks run inside the observed program, so every recorder function may use only
// built-ins captured at preload. A global named inside any function body is a defect.
const callTimeGlobals = new Set([
  "Array",
  "Boolean",
  "Buffer",
  "Date",
  "Error",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "Reflect",
  "Set",
  "String",
  "Symbol",
  "URL",
  "WeakMap",
  "WeakSet",
  "globalThis",
  "process",
  "require",
]);

function callTimeGlobalReads(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const deferred = (node) =>
    ts.isFunctionLike(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node);
  const visit = (node, inside) => {
    if (ts.isIdentifier(node) && inside && callTimeGlobals.has(node.text)) {
      const parent = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node);
      if (!isName) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${path}:${line + 1} ${node.text}`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside || deferred(node)));
  };
  visit(source, false);
  return found;
}

it("lets recorder functions use only built-ins captured at preload", async () => {
  const directory = resolve(import.meta.dirname, "../lib");
  const modules = (await readdir(directory)).filter((name) =>
    /^ci-test-input-.+\.cjs$/u.test(name),
  );
  expect(modules.length).toBeGreaterThanOrEqual(9);
  const found = [];
  for (const name of modules)
    found.push(...callTimeGlobalReads(name, await readFile(resolve(directory, name), "utf8")));
  expect(found).toEqual([]);
  // The scan itself recognizes a call-time read.
  expect(
    callTimeGlobalReads("probe.cjs", "const a = Error; function f() { return Object.keys(a); }"),
  ).toEqual(["probe.cjs:1 Object"]);
});
