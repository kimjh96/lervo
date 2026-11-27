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
// With LERVO_MEASURE_VMMAP=1 it writes `vmmap --summary` of the WebContent process to stderr as it
// samples, which separates the JavaScript heap from graphics memory.
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
  "idle-unfocused",
  "idle-lone-field",
  "idle-lone-field-opaque",
  "idle-hidden",
  "conversation",
  "streaming",
  "keystroke",
];
// The page settles and observes an idle window before it reports, so sampling starts at once.
const IDLE_SAMPLE_MS = 30_000;
// `ps` counts CPU time in hundredths of a second, so 30 seconds resolve 0.03% per process. The
// hidden budget of 0.1% across three processes needs a longer sample.
const IDLE_HIDDEN_SAMPLE_MS = 120_000;

const FRAME_MS = 1000 / 60;
const PACE_MS = 120;

/**
 * The budgets of `docs/foundation/ade-convention/performance.md` that the scenarios measure, and
 * the motion specification's pace. Each is a maximum.
 */
const budgets = {
  coldStartMs: 500,
  // With no text field focused; a focused field's caret redraws the window.
  idleVisibleCpuPercent: 0.5,
  idleFocusedChanges: 0,
  idleHiddenCpuPercent: 0.1,
  firstPaintMs: 100,
  frameMaxMs: 50,
  deltaToPageP95Ms: 33,
  deltaToScreenP95Ms: 33 + PACE_MS,
  trailMaxMs: Math.round(PACE_MS + FRAME_MS),
  // The next frame: within one and a half frame intervals, since a missed frame reads two.
  echoP95Ms: Math.round(1.5 * FRAME_MS),
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

/** Which part of the window a process is: the shell, or one of WebKit's processes. */
function processRole(process, shellPid) {
  if (process.pid === shellPid) return "shell";
  for (const role of ["WebContent", "GPU", "Networking"])
    if (process.command.includes(role)) return role;
  return "other";
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
      if (page.error !== undefined) return result;
      if (scenario === "cold-start") {
        const round = (value) => Math.round(value * 100) / 100;
        result.coldStartMs = round(page.timeOriginEpochMs - launchedEpochMs + page.startScreenMs);
        // Launch to the shell's `main` is the process start; `main` to navigation is the shell
        // creating its window and webview.
        result.launchToMainMs = round(page.mainEpochMs - launchedEpochMs);
        result.mainToNavigationMs = round(page.timeOriginEpochMs - page.mainEpochMs);
      }
      if (scenario.startsWith("idle-")) {
        const sampleMs = scenario === "idle-hidden" ? IDLE_HIDDEN_SAMPLE_MS : IDLE_SAMPLE_MS;
        const before = windowProcesses(window.pid, webkitBefore);
        await sleep(sampleMs);
        const after = windowProcesses(window.pid, webkitBefore);
        const percent = (seconds) => Math.round((seconds / (sampleMs / 1000)) * 100000) / 1000;
        const byRole = {};
        for (const process of after) {
          const spent = process.cpu - (before.find((old) => old.pid === process.pid)?.cpu ?? 0);
          const role = processRole(process, window.pid);
          byRole[role] = (byRole[role] ?? 0) + spent;
        }
        result.cpuPercent = percent(
          Object.values(byRole).reduce((total, spent) => total + spent, 0),
        );
        result.cpuPercentByProcess = Object.fromEntries(
          Object.entries(byRole).map(([role, spent]) => [role, percent(spent)]),
        );
      }
      const resident = windowProcesses(window.pid, webkitBefore);
      const megabytes = (kilobytes) => Math.round(kilobytes / 10.24) / 100;
      result.residentMb = megabytes(resident.reduce((total, p) => total + p.rssKb, 0));
      if (process.env.LERVO_MEASURE_VMMAP === "1")
        for (const p of resident.filter((p) => processRole(p, window.pid) === "WebContent"))
          process.stderr.write(
            execFileSync("vmmap", ["--summary", String(p.pid)], { encoding: "utf8" }),
          );
      // Which process holds it: the shell, or one of WebKit's.
      const byRole = {};
      for (const process of resident) {
        const role = processRole(process, window.pid);
        byRole[role] = (byRole[role] ?? 0) + process.rssKb;
      }
      result.residentMbByProcess = Object.fromEntries(
        Object.entries(byRole).map(([role, kilobytes]) => [role, megabytes(kilobytes)]),
      );
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

/** An idle result, only when its window was in front and the expected element held focus. */
function idleResult(by, scenario, focused) {
  const result = by[scenario];
  return result?.windowFocused === true && result.focused === focused ? result : undefined;
}

function verdicts(results) {
  const by = Object.fromEntries(results.map((result) => [result.scenario, result]));
  const focusedIdle = idleResult(by, "idle-visible", "textarea");
  const checks = [
    ["Cold start to the start screen", by["cold-start"]?.coldStartMs, budgets.coldStartMs],
    [
      "UI CPU, idle, window visible, no field focused (%)",
      idleResult(by, "idle-unfocused", "body")?.cpuPercent,
      budgets.idleVisibleCpuPercent,
    ],
    [
      "Idle with the input card focused: DOM changes and running animations",
      focusedIdle && focusedIdle.domChangesIn10s + focusedIdle.runningAnimations,
      budgets.idleFocusedChanges,
    ],
    [
      "UI CPU, idle, window hidden (%)",
      by["idle-hidden"]?.cpuPercent,
      budgets.idleHiddenCpuPercent,
    ],
    ["First paint of 100,000 items", by.conversation?.firstPaintMs, budgets.firstPaintMs],
    ["Longest frame while scrolling", by.conversation?.frameMaxMs, budgets.frameMaxMs],
    ["Streamed delta to the page, p95", by.streaming?.deltaToPageP95Ms, budgets.deltaToPageP95Ms],
    ["Streamed delta to screen, p95", by.streaming?.deltaToScreenP95Ms, budgets.deltaToScreenP95Ms],
    ["Streamed text trailing its arrival, max", by.streaming?.trailMaxMs, budgets.trailMaxMs],
    ["Keystroke to echo, p95 (page events)", by.keystroke?.echoP95Ms, budgets.echoP95Ms],
  ];
  return checks.map(([measure, value, budget]) => ({
    measure,
    value: value ?? null,
    budget,
    within: typeof value === "number" ? value <= budget : null,
  }));
}

/** Figures with no budget that explain the idle ones: the caret's cost and the material's share. */
function comparisons(results) {
  const by = Object.fromEntries(results.map((result) => [result.scenario, result]));
  const cpu = (scenario) => idleResult(by, scenario, "textarea")?.cpuPercent ?? null;
  return {
    focusedStartScreenCpuPercent: cpu("idle-visible"),
    loneFieldCpuPercent: cpu("idle-lone-field"),
    loneFieldOpaqueCpuPercent: cpu("idle-lone-field-opaque"),
  };
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
process.stdout.write(
  `${JSON.stringify({ results, verdicts: verdicts(results), comparisons: comparisons(results) }, null, 2)}\n`,
);
