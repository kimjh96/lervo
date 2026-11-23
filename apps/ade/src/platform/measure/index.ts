// The interface harness (ADE performance, "Measurement"; roadmap S1.6b). The shell injects a
// scenario only when the harness starts it, and the composition root loads this module only then,
// so it adds nothing to the start screen. It drives the app through the DOM, as a person would,
// and never through a store, so it measures what a person waits for.

/** What one scenario measured: milliseconds unless the name says otherwise. */
type Report = Record<string, number | boolean | string>;

const LOG = '[role="log"]';
const SAMPLE_LIMIT = 2000;

/**
 * The time of the next frame. Its animation callbacks run right before it paints, so a change
 * made earlier is on screen at this time, give or take the compositor.
 */
function nextPaint(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Resolves once `found` returns an element, checking once per frame, or rejects at `limitMs`. */
async function waitFor<T>(found: () => T | null, limitMs = 15_000): Promise<T> {
  const deadline = performance.now() + limitMs;
  for (;;) {
    const value = found();
    if (value !== null) return value;
    if (performance.now() > deadline) throw new Error("measure_wait_timeout");
    await nextPaint();
  }
}

function quantile(samples: readonly number[], q: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The start screen, once the launch view has left: the frame's navigation is on screen. */
async function startScreen(): Promise<number> {
  await waitFor(() => document.querySelector("nav"));
  return nextPaint();
}

/** Opens the workspace whose row reads `title` in the workspace list. */
async function openWorkspace(title: string): Promise<void> {
  const row = await waitFor(
    () =>
      [...document.querySelectorAll<HTMLButtonElement>("nav button")].find((button) =>
        (button.textContent ?? "").includes(title),
      ) ?? null,
  );
  row.click();
}

/** Types `text` into the focused input card the way React reads it, then waits for its paint. */
async function type(field: HTMLTextAreaElement, text: string): Promise<number> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const started = performance.now();
  setter?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  const painted = await nextPaint();
  return painted - started;
}

async function coldStart(): Promise<Report> {
  // The page's clock starts at navigation; the harness adds the time from launch to navigation.
  const painted = await startScreen();
  return { startScreenMs: rounded(painted), timeOriginEpochMs: rounded(performance.timeOrigin) };
}

async function idle(hidden: boolean): Promise<Report> {
  const painted = await startScreen();
  if (hidden) await (await import("@tauri-apps/api/core")).invoke("measure_hide");
  return { startScreenMs: rounded(painted), hidden };
}

/** Opens the 100,000-item conversation, then scrolls it toward its oldest items. */
async function conversation(): Promise<Report> {
  await startScreen();
  const opened = performance.now();
  await openWorkspace("Design the desktop app");
  const log = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(LOG);
    return found !== null && found.querySelectorAll("[data-index]").length > 0 ? found : null;
  });
  const firstPaint = (await nextPaint()) - opened;
  const frames: number[] = [];
  let previous = await nextPaint();
  for (let frame = 0; frame < 600; frame += 1) {
    log.scrollTop = Math.max(0, log.scrollTop - 600);
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    frames.push(now - previous);
    previous = now;
  }
  return {
    firstPaintMs: rounded(firstPaint),
    frames: frames.length,
    frameP50Ms: rounded(quantile(frames, 0.5)),
    frameP95Ms: rounded(quantile(frames, 0.95)),
    frameMaxMs: rounded(Math.max(...frames)),
    framesOver50Ms: frames.filter((duration) => duration > 50).length,
  };
}

/**
 * Asks the streaming provider for a reply and measures, at each frame, how long the newest
 * delta on screen took from the provider's clock to the paint. The provider stamps each delta
 * with the wall clock in microseconds.
 */
async function streaming(): Promise<Report> {
  await startScreen();
  await openWorkspace("Stream a long reply");
  const field = await waitFor(() => document.querySelector<HTMLTextAreaElement>("main textarea"));
  field.focus();
  await type(field, "Stream now");
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const log = await waitFor(() => document.querySelector<HTMLElement>(LOG));
  const samples: number[] = [];
  let newest = 0;
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline && samples.length < SAMPLE_LIMIT) {
    const painted = await nextPaint();
    const stamps = [...(log.textContent ?? "").matchAll(/t(\d{16}) streamed/gu)];
    const last = stamps.at(-1)?.[1];
    if (last === undefined) continue;
    const stamp = Number(last) / 1000;
    if (stamp <= newest) {
      if (newest > 0 && performance.now() - painted > 1000) break;
      continue;
    }
    newest = stamp;
    samples.push(performance.timeOrigin + painted - stamp);
  }
  return {
    deltasSampled: samples.length,
    deltaToScreenP50Ms: rounded(quantile(samples, 0.5)),
    deltaToScreenP95Ms: rounded(quantile(samples, 0.95)),
    deltaToScreenMaxMs: rounded(Math.max(...samples)),
  };
}

/**
 * Types into the input card and measures each keystroke from its input event to the paint that
 * shows it. Events come from the page, not the operating system, so this is the interface's
 * share of the echo, without the system's input path.
 */
async function keystroke(): Promise<Report> {
  await startScreen();
  await openWorkspace("Stream a long reply");
  const field = await waitFor(() => document.querySelector<HTMLTextAreaElement>("main textarea"));
  field.focus();
  const samples: number[] = [];
  let text = "";
  for (let key = 0; key < 200; key += 1) {
    text += "abcdefghij"[key % 10] ?? "a";
    samples.push(await type(field, text));
  }
  return {
    keystrokes: samples.length,
    echoP50Ms: rounded(quantile(samples, 0.5)),
    echoP95Ms: rounded(quantile(samples, 0.95)),
    echoMaxMs: rounded(Math.max(...samples)),
  };
}

const scenarios: Record<string, () => Promise<Report>> = {
  "cold-start": coldStart,
  "idle-visible": () => idle(false),
  "idle-hidden": () => idle(true),
  conversation,
  streaming,
  keystroke,
};

/** Runs `scenario` and hands its report to the shell, which writes it where the harness reads. */
export async function runMeasurement(scenario: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const run = scenarios[scenario];
  let report: Report;
  try {
    report = run === undefined ? { error: "scenario_unknown" } : await run();
  } catch (error) {
    report = { error: error instanceof Error ? error.message : "measure_failed" };
  }
  await invoke("measure_report", { report: JSON.stringify({ scenario, ...report }) });
}
