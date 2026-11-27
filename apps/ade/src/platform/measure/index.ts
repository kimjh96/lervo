// The interface harness (ADE performance, "Measurement"; roadmap S1.6b). The shell injects a
// scenario only when the harness starts it, and the composition root loads this module only then,
// so it adds nothing to the start screen. It drives the app through the DOM, as a person would,
// and never through a store, so it measures what a person waits for.

/** What one scenario measured: milliseconds unless the name says otherwise. */
type Report = Record<string, number | boolean | string>;

/** The session host's messages, as the composition root's client delivers them. */
interface HostMessages {
  onMessage(listener: (message: { kind: string } & Record<string, unknown>) => void): () => void;
}

/** The provider's wall-clock stamps, in milliseconds, in a streamed text. */
function stamps(text: string): number[] {
  return [...text.matchAll(/t(\d{16}) streamed/gu)].map((match) => Number(match[1]) / 1000);
}

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

/**
 * The opened conversation's reply field. The conversation is a lazy chunk, so the start screen's
 * card can still be the only field right after the click; the reply card counts once the
 * conversation's log is on the page and the start screen's card has left.
 */
function replyField(): Promise<HTMLTextAreaElement> {
  return waitFor(() => {
    const fields = document.querySelectorAll<HTMLTextAreaElement>("main textarea");
    return document.querySelector(LOG) !== null && fields.length === 1 ? (fields[0] ?? null) : null;
  });
}

/**
 * Types `text` into the focused input card the way React reads it, then waits for its paint.
 * `workMs` is the interface's own work: React flushes an input event's update in a microtask
 * queued during the dispatch, which runs before this function continues.
 */
async function type(
  field: HTMLTextAreaElement,
  text: string,
): Promise<{ echoMs: number; workMs: number }> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const started = performance.now();
  setter?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await Promise.resolve();
  const worked = performance.now();
  const painted = await nextPaint();
  return { echoMs: painted - started, workMs: worked - started };
}

/** When the page's own steps happened, from navigation: the `lervo:` marks and its scripts. */
function startupPhases(): string {
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const phases: [string, number][] = [];
  if (navigation !== undefined)
    phases.push(
      ["document", navigation.responseEnd],
      ["DOM interactive", navigation.domInteractive],
      ["DOM content loaded", navigation.domContentLoadedEventEnd],
    );
  for (const script of performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    if (script.name.endsWith(".js"))
      phases.push([`${script.name.split("/").at(-1) ?? "script"} loaded`, script.responseEnd]);
  for (const mark of performance.getEntriesByType("mark"))
    if (mark.name.startsWith("lervo:")) phases.push([mark.name.slice(6), mark.startTime]);
  return phases
    .sort((left, right) => left[1] - right[1])
    .map(([phase, at]) => `${phase}@${Math.round(at)}`)
    .join(" ");
}

async function coldStart(): Promise<Report> {
  // The page's clock starts at navigation; the harness adds the time from launch to navigation,
  // split at the moment the shell's `main` began.
  const painted = await startScreen();
  const injected = (globalThis as { __LERVO_MEASURE__?: { mainEpochMs?: number } })
    .__LERVO_MEASURE__;
  return {
    startScreenMs: rounded(painted),
    timeOriginEpochMs: rounded(performance.timeOrigin),
    mainEpochMs: injected?.mainEpochMs ?? Number.NaN,
    phases: startupPhases(),
  };
}

const IDLE_SETTLE_MS = 5_000;
const IDLE_OBSERVE_MS = 10_000;

/**
 * What an idle window shows. `field` is the start screen with its input card focused, as it opens;
 * `unfocused` drops that focus, so no caret blinks; `lone-field` replaces the page with one focused
 * text field, the caret's cost on its own; `lone-field-opaque` does the same in an opaque window,
 * which tells the native material's share apart.
 */
type IdleView = "field" | "unfocused" | "lone-field" | "lone-field-opaque" | "hidden";

async function prepareIdle(view: IdleView): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  if (view === "hidden") await invoke("measure_hide");
  if (view === "unfocused" && document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
  if (view === "lone-field-opaque") {
    await invoke("measure_opaque");
    document.documentElement.dataset.material = "opaque";
  }
  if (view === "lone-field" || view === "lone-field-opaque") {
    const field = document.createElement("textarea");
    document.body.replaceChildren(field);
    field.focus();
  }
}

/**
 * The window left alone. After `IDLE_SETTLE_MS` it counts, for `IDLE_OBSERVE_MS`, what could keep
 * the window drawing: DOM changes, the session host's messages, and, at the end, the animations
 * still running, which motion principle 4 allows only for working status. The driver samples CPU
 * right after this report.
 */
async function idle(view: IdleView, host: HostMessages): Promise<Report> {
  const painted = await startScreen();
  await prepareIdle(view);
  await new Promise((resolve) => setTimeout(resolve, IDLE_SETTLE_MS));
  let changes = 0;
  let messages = 0;
  const observer = new MutationObserver((records) => {
    changes += records.length;
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const stop = host.onMessage(() => {
    messages += 1;
  });
  await new Promise((resolve) => setTimeout(resolve, IDLE_OBSERVE_MS));
  observer.disconnect();
  stop();
  const running = document
    .getAnimations()
    .filter((animation) => animation.playState === "running")
    .map((animation) =>
      animation instanceof CSSAnimation ? animation.animationName : "script animation",
    );
  return {
    startScreenMs: rounded(painted),
    focused: document.activeElement?.tagName.toLowerCase() ?? "none",
    // A window in the background stops its caret, so idle figures compare only with focus.
    windowFocused: document.hasFocus(),
    domChangesIn10s: changes,
    hostMessagesIn10s: messages,
    runningAnimations: running.length,
    runningAnimationNames: running.join(", "),
  };
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
  // The list stays hidden until its measured height settles at its end, so the conversation
  // first shows in the frame after its list is placed. An observer sees the placing as it
  // happens, where polling each frame would read up to a frame late.
  await new Promise<void>((resolve) => {
    if (log.querySelector("[data-placed]") !== null) return resolve();
    const observer = new MutationObserver(() => {
      if (log.querySelector("[data-placed]") === null) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(log, { attributes: true, attributeFilter: ["data-placed"], subtree: true });
  });
  const firstPaint = (await nextPaint()) - opened;
  // Each step of the open, from the click: the `lervo:conversation-` marks the controller sets.
  const steps = Object.fromEntries(
    performance
      .getEntriesByType("mark")
      .filter((mark) => mark.name.startsWith("lervo:conversation-") && mark.startTime >= opened)
      .map((mark) => [
        mark.name.slice("lervo:conversation-".length),
        rounded(mark.startTime - opened),
      ]),
  );
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
    firstPaintSteps: JSON.stringify(steps),
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
async function streaming(host: HostMessages): Promise<Report> {
  // When each delta reached the page, before the store, the render, and the pacer.
  const received: number[] = [];
  const arrivals = new Map<number, number>();
  const stop = host.onMessage((message) => {
    if (message.kind !== "conversation.delta" || typeof message.append !== "string") return;
    const now = performance.timeOrigin + performance.now();
    for (const stamp of stamps(message.append)) {
      received.push(now - stamp);
      arrivals.set(stamp, now);
    }
  });
  await startScreen();
  await openWorkspace("Stream a long reply");
  const field = await replyField();
  field.focus();
  await type(field, "Stream now");
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const log = await waitFor(() => document.querySelector<HTMLElement>(LOG));
  const samples: number[] = [];
  // How long the newest text on screen trailed its arrival at the page: the pacer's share.
  const trails: number[] = [];
  let newest = 0;
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline && samples.length < SAMPLE_LIMIT) {
    const painted = await nextPaint();
    const stamp = stamps(log.textContent ?? "").at(-1);
    if (stamp === undefined) continue;
    if (stamp <= newest) {
      if (newest > 0 && performance.now() - painted > 1000) break;
      continue;
    }
    newest = stamp;
    samples.push(performance.timeOrigin + painted - stamp);
    const arrived = arrivals.get(stamp);
    if (arrived !== undefined) trails.push(performance.timeOrigin + painted - arrived);
  }
  stop();
  return {
    deltasReceived: received.length,
    deltaToPageP50Ms: rounded(quantile(received, 0.5)),
    deltaToPageP95Ms: rounded(quantile(received, 0.95)),
    deltasSampled: samples.length,
    deltaToScreenP50Ms: rounded(quantile(samples, 0.5)),
    deltaToScreenP95Ms: rounded(quantile(samples, 0.95)),
    deltaToScreenMaxMs: rounded(Math.max(...samples)),
    trailP95Ms: rounded(quantile(trails, 0.95)),
    trailMaxMs: rounded(Math.max(...trails)),
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
  const field = await replyField();
  field.focus();
  const echoes: number[] = [];
  const work: number[] = [];
  let text = "";
  for (let key = 0; key < 200; key += 1) {
    text += "abcdefghij"[key % 10] ?? "a";
    const { echoMs, workMs } = await type(field, text);
    echoes.push(echoMs);
    work.push(workMs);
  }
  return {
    keystrokes: echoes.length,
    echoP50Ms: rounded(quantile(echoes, 0.5)),
    echoP95Ms: rounded(quantile(echoes, 0.95)),
    echoMaxMs: rounded(Math.max(...echoes)),
    workP95Ms: rounded(quantile(work, 0.95)),
    workMaxMs: rounded(Math.max(...work)),
  };
}

const scenarios: Record<string, (host: HostMessages) => Promise<Report>> = {
  "cold-start": coldStart,
  "idle-visible": (host) => idle("field", host),
  "idle-unfocused": (host) => idle("unfocused", host),
  "idle-lone-field": (host) => idle("lone-field", host),
  "idle-lone-field-opaque": (host) => idle("lone-field-opaque", host),
  "idle-hidden": (host) => idle("hidden", host),
  conversation,
  streaming,
  keystroke,
};

/** Runs `scenario` and hands its report to the shell, which writes it where the harness reads. */
export async function runMeasurement(scenario: string, host: HostMessages): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const run = scenarios[scenario];
  let report: Report;
  try {
    report = run === undefined ? { error: "scenario_unknown" } : await run(host);
  } catch (error) {
    report = { error: error instanceof Error ? error.message : "measure_failed" };
  }
  await invoke("measure_report", { report: JSON.stringify({ scenario, ...report }) });
}
