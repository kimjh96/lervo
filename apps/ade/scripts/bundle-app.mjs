// Builds the desktop application with the session host inside it. The shell starts the session
// host from beside its own executable (ADE session host protocol, "Transport"), so the bundle
// carries `lervo-session-host` as a Tauri external binary, which Tauri places there without its
// target suffix. The binary is staged in src-tauri/binaries/, which Git ignores, and only the
// configuration this script passes names it, so `cargo build`, Clippy, and the tests never need it.
//
// Usage: pnpm --filter @lervo/ade bundle [tauri build options], such as `--bundles app`.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/** The Rust target `rustc -vV` reports as its host, such as `aarch64-apple-darwin`. */
export function hostTarget(rustcVersion) {
  const target = /^host: (\S+)$/mu.exec(rustcVersion)?.[1];
  if (target === undefined) throw new Error("rustc -vV reported no host target");
  return target;
}

/** The name Tauri looks for when it bundles the session host for `target`. */
export function stagedName(target) {
  return `lervo-session-host-${target}${target.includes("-windows-") ? ".exe" : ""}`;
}

/** The session host's executable, from the JSON messages of `cargo build`. */
export function builtExecutable(messages) {
  for (const line of messages.split("\n")) {
    if (!line.startsWith("{")) continue;
    const message = JSON.parse(line);
    if (
      message.reason === "compiler-artifact" &&
      message.target?.name === "lervo-session-host" &&
      typeof message.executable === "string"
    )
      return message.executable;
  }
  throw new Error("cargo build reported no lervo-session-host executable");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = hostTarget(execFileSync("rustc", ["-vV"], { cwd: root, encoding: "utf8" }));
  const messages = execFileSync(
    "cargo",
    [
      "build",
      "--release",
      "--locked",
      "-p",
      "lervo-session-host",
      "--message-format=json-render-diagnostics",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 },
  );
  const staging = join(root, "src-tauri/binaries");
  mkdirSync(staging, { recursive: true });
  copyFileSync(builtExecutable(messages), join(staging, stagedName(target)));
  const options = process.argv.slice(2);
  execFileSync(
    "pnpm",
    [
      "tauri",
      "build",
      "--config",
      join(root, "src-tauri/tauri.bundle.conf.json"),
      ...(options[0] === "--" ? options.slice(1) : options),
    ],
    { cwd: root, stdio: "inherit" },
  );
}
