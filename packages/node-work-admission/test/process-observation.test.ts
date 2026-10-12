import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import {
  darwinBirthIdentity,
  linuxBirthIdentity,
  windowsBirthIdentity,
} from "../src/process-birth.js";
import { createProcessObserver } from "../src/process-observation.js";

const boot = "01234567-89ab-cdef-0123-456789abcdef";
const stat = (start: string) =>
  `123 (odd ) name\n)) S ${Array(18).fill("0").join(" ")} ${start} 0 0`;

it("binds Linux birth to boot and start ticks without splitting the command name", () => {
  const identity = linuxBirthIdentity(123, boot, stat("987"));
  expect(identity).toMatch(/^proc_[a-z0-9_]+:sha256:[a-f0-9]{64}$/u);
  expect(linuxBirthIdentity(123, boot, stat("987"))).toBe(identity);
  expect(linuxBirthIdentity(123, boot, stat("988"))).not.toBe(identity);
  expect(linuxBirthIdentity(123, boot.replace("01234567", "ffffffff"), stat("987"))).not.toBe(
    identity,
  );
  expect(linuxBirthIdentity(124, boot, stat("987"))).toBeNull();
  expect(linuxBirthIdentity(123, "unknown", stat("987"))).toBeNull();
  expect(linuxBirthIdentity(123, boot, stat("-1"))).toBeNull();
  expect(linuxBirthIdentity(123, boot, "123 (truncated)")).toBeNull();
});

it("keeps ambiguous Darwin second-resolution observations equal and binds reboot", () => {
  const start = "Sun Oct 11 01:02:03 2026";
  const identity = darwinBirthIdentity(123, boot, start);
  expect(identity).toMatch(/^proc_[a-z0-9_]+:sha256:[a-f0-9]{64}$/u);
  expect(darwinBirthIdentity(123, boot, start)).toBe(identity);
  expect(darwinBirthIdentity(123, boot, start.replace("01:02:03", "01:02:04"))).not.toBe(identity);
  expect(darwinBirthIdentity(123, boot.replace("01234567", "ffffffff"), start)).not.toBe(identity);
  expect(darwinBirthIdentity(123, boot, "invalid")).toBeNull();
});

it("preserves Windows FILETIME precision without converting it to a JavaScript number", () => {
  const identity = windowsBirthIdentity(123, "134045029230000001\r\n");
  expect(identity).toMatch(/^proc_[a-z0-9_]+:sha256:[a-f0-9]{64}$/u);
  expect(windowsBirthIdentity(123, "134045029230000002")).not.toBe(identity);
  for (const value of ["0", "-1", "1e17", "error", "1\n2"])
    expect(windowsBirthIdentity(123, value)).toBeNull();
});

it("observes real own/child births consistently and proves exit only after child termination", async () => {
  const observe = createProcessObserver(),
    another = createProcessObserver();
  expect(observe(process.pid).status).toBe("present");
  expect(another(process.pid)).toEqual(observe(process.pid));
  const child = spawn(
    process.execPath,
    ["-e", "process.stdout.write('ready'); setInterval(()=>{},1000)"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await once(child.stdout!, "data");
    const first = observe(child.pid!);
    expect(first.status).toBe("present");
    expect(another(child.pid!)).toEqual(first);
    expect(first).not.toEqual(observe(process.pid));
    const ended = once(child, "exit");
    child.kill();
    await ended;
    expect(observe(child.pid!)).toEqual({ status: "absent" });
    expect(observe(-1)).toEqual({ status: "unknown" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}, 20_000);
