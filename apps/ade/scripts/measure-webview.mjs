// The interface harness's driver (ADE performance, "Measurement"; roadmap S1.6b). For each
// scenario it serves the scripted core of `session-host/examples/interface`, opens the release
// shell with the scenario, waits for the page's report, and samples the processes the window
// runs in. It needs the release builds first:
//
//   pnpm build
//   cargo build --release --locked -p lervo-session-host --example interface
//   cargo build --release --locked -p lervo-ade --features tauri/custom-protocol
//
// Usage: node scripts/measure-webview.mjs [scenario...] > results.json
// It opens a window on the screen for each scenario, so run it while nobody is using the Mac.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shell = join(root, "target/release/Lervo");
const scriptedCore = join(root, "target/release/examples/interface");
const scenarios = [
  "cold-start",
  "idle-visible",
  "idle-hidden",
  "conversation",
  "streaming",
  "keystroke",
];
const IDLE_SETTLE_MS = 10_000;
const IDLE_SAMPLE_MS = 30_000;

/** The budgets of `docs/foundation/ade-convention/performance.md` that the scenarios measure. */
const budgets = {
  coldStartMs: 500,
  idleVisibleCpuPercent: 0.5,
  idleHiddenCpuPercent: 0.1,
  firstPaintMs: 100,
  frameMaxMs: 50,
  deltaToScreenP95Ms: 33,
  echoP95Ms: 16,
};

const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

/** CPU seconds from `ps`'s `[[hh:]mm:]ss.cc` time. */
function cpuSeconds(value) {
  return value
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

/** Every process, with its CPU seconds, resident kilobytes, and command name. */
function processes() {
  return execFileSync("ps", ["-A", "-o", "pid=,time=,rss=,comm="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/u))
    .filter(Boolean)
    .map(([, pid, time, rss, command]) => ({
      pid: Number(pid),
      cpu: cpuSeconds(time),
      rssKb: Number(rss),
      command,
    }));
}

/** The shell and the WebKit processes that started with it, which render its window. */
function windowProcesses(shellPid, webkitBefore) {
  return processes().filter(
    (process) =>
      process.pid === shellPid ||
      (process.command.includes("com.apple.WebKit") && !webkitBefore.has(process.pid)),
  );
}

function environment(extra) {
  // An enclosing agent session's markers would reach the scripted core's providers.
  const kept = Object.entries(process.env).filter(
    ([name]) => !/^(CLAUDE|CLAUDECODE|OTEL_)/u.test(name),
  );
  return { ...Object.fromEntries(kept), ...extra };
}

async function waitForFile(path, limitMs, isReady = existsSync) {
  const deadline = Date.now() + limitMs;
  while (!isReady(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await sleep(100);
  }
}

async function measure(scenario) {
  const state = mkdtempSync(join(tmpdir(), "lervo-measure-"));
  const report = join(state, "report.json");
  const core = spawn(scriptedCore, ["serve", state], { env: environment({}), stdio: "ignore" });
  try {
    // Seeding the 100,000-item conversation takes a few seconds before the socket appears.
    await waitForFile(state, 60_000, (path) =>
      readdirSync(path, { recursive: true }).some((name) => String(name).endsWith(".sock")),
    );
    const webkitBefore = new Set(
      processes()
        .filter((process) => process.command.includes("com.apple.WebKit"))
        .map((process) => process.pid),
    );
    const launchedEpochMs = Date.now();
    const window = spawn(shell, [], {
      env: environment({
        LERVO_SESSION_HOST_DIR: state,
        LERVO_ADE_MEASURE: scenario,
        LERVO_ADE_MEASURE_OUT: report,
      }),
      stdio: "ignore",
    });
    try {
      await waitForFile(report, 90_000);
      const page = JSON.parse(readFileSync(report, "utf8"));
      const result = { ...page };
      if (scenario === "cold-start")
        result.coldStartMs =
          Math.round((page.timeOriginEpochMs - launchedEpochMs + page.startScreenMs) * 100) / 100;
      if (scenario.startsWith("idle-")) {
        await sleep(IDLE_SETTLE_MS);
        const before = windowProcesses(window.pid, webkitBefore);
        await sleep(IDLE_SAMPLE_MS);
        const after = windowProcesses(window.pid, webkitBefore);
        const spent = after.reduce(
          (total, process) =>
            total + process.cpu - (before.find((old) => old.pid === process.pid)?.cpu ?? 0),
          0,
        );
        result.cpuPercent = Math.round((spent / (IDLE_SAMPLE_MS / 1000)) * 10000) / 100;
      }
      result.residentMb =
        Math.round(
          windowProcesses(window.pid, webkitBefore).reduce((total, p) => total + p.rssKb, 0) /
            10.24,
        ) / 100;
      return result;
    } finally {
      window.kill("SIGTERM");
    }
  } finally {
    core.kill("SIGTERM");
    await sleep(500);
    rmSync(state, { recursive: true, force: true });
  }
}

function verdicts(results) {
  const by = Object.fromEntries(results.map((result) => [result.scenario, result]));
  const checks = [
    ["Cold start to the start screen", by["cold-start"]?.coldStartMs, budgets.coldStartMs],
    [
      "UI CPU, idle, window visible (%)",
      by["idle-visible"]?.cpuPercent,
      budgets.idleVisibleCpuPercent,
    ],
    [
      "UI CPU, idle, window hidden (%)",
      by["idle-hidden"]?.cpuPercent,
      budgets.idleHiddenCpuPercent,
    ],
    ["First paint of 100,000 items", by.conversation?.firstPaintMs, budgets.firstPaintMs],
    ["Longest frame while scrolling", by.conversation?.frameMaxMs, budgets.frameMaxMs],
    ["Streamed delta to screen, p95", by.streaming?.deltaToScreenP95Ms, budgets.deltaToScreenP95Ms],
    ["Keystroke to echo, p95 (page events)", by.keystroke?.echoP95Ms, budgets.echoP95Ms],
  ];
  return checks.map(([measure, value, budget]) => ({
    measure,
    value: value ?? null,
    budget,
    within: typeof value === "number" ? value <= budget : null,
  }));
}

if (!existsSync(shell) || !existsSync(scriptedCore)) {
  process.stderr.write(
    "Build the release shell and the interface example first; see the header.\n",
  );
  process.exit(2);
}
const chosen = process.argv.slice(2).length > 0 ? process.argv.slice(2) : scenarios;
const results = [];
for (const scenario of chosen) {
  process.stderr.write(`measuring ${scenario}\n`);
  results.push(await measure(scenario));
}
process.stdout.write(`${JSON.stringify({ results, verdicts: verdicts(results) }, null, 2)}\n`);
