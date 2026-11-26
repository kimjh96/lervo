// Builds the desktop application with the session host inside it. The shell starts the session
// host from beside its own executable (ADE session host protocol, "Transport"), so the bundle
// carries `lervo-session-host` as a Tauri external binary, which Tauri places there without its
// target suffix. The binary is staged in src-tauri/binaries/, which Git ignores, and only the
// configuration this script passes names it, so `cargo build`, Clippy, and the tests never need it.
//
// On macOS the app icon is the Icon Composer document `src-tauri/icons/AppIcon.icon`, which Xcode's
// asset compiler turns into `Assets.car`, named by `CFBundleIconName` in `src-tauri/Info.plist`.
// macOS 26 draws it with its icon styles, and earlier macOS reads `icons/icon.icns`. Without Xcode
// the bundle carries the `.icns` alone.
//
// Usage: pnpm --filter @lervo/ade bundle [tauri build options], such as `--bundles app`.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** The bundle configuration with the compiled app icon placed in the app's resources. */
export function withAppIcon(configuration, assetCatalog) {
  const bundle = configuration.bundle ?? {};
  const macOS = bundle.macOS ?? {};
  return {
    ...configuration,
    bundle: {
      ...bundle,
      macOS: { ...macOS, files: { ...macOS.files, "Resources/Assets.car": assetCatalog } },
    },
  };
}

/** Xcode's developer directory when its asset compiler can run, or undefined. */
function xcodeDeveloperDirectory() {
  for (const directory of [undefined, "/Applications/Xcode.app/Contents/Developer"]) {
    const env =
      directory === undefined ? process.env : { ...process.env, DEVELOPER_DIR: directory };
    try {
      execFileSync("xcrun", ["actool", "--version"], { env, stdio: "ignore" });
      return env;
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

/** Compiles the app icon into `Assets.car` in `staging`, or returns undefined without Xcode. */
function compileAppIcon(staging) {
  if (process.platform !== "darwin") return undefined;
  const env = xcodeDeveloperDirectory();
  if (env === undefined) {
    process.stderr.write("Xcode's actool is unavailable; the bundle carries icon.icns alone.\n");
    return undefined;
  }
  const output = join(staging, "app-icon");
  mkdirSync(output, { recursive: true });
  execFileSync(
    "xcrun",
    [
      "actool",
      join(root, "src-tauri/icons/AppIcon.icon"),
      "--compile",
      output,
      "--platform",
      "macosx",
      "--minimum-deployment-target",
      "11.0",
      "--app-icon",
      "AppIcon",
      "--output-partial-info-plist",
      join(output, "partial.plist"),
    ],
    { env, stdio: ["ignore", "ignore", "inherit"] },
  );
  const catalog = join(output, "Assets.car");
  return existsSync(catalog) ? catalog : undefined;
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
  let configuration = join(root, "src-tauri/tauri.bundle.conf.json");
  const catalog = compileAppIcon(staging);
  if (catalog !== undefined) {
    configuration = join(staging, "tauri.bundle.conf.json");
    const base = JSON.parse(readFileSync(join(root, "src-tauri/tauri.bundle.conf.json"), "utf8"));
    writeFileSync(configuration, `${JSON.stringify(withAppIcon(base, catalog), null, 2)}\n`);
  }
  const options = process.argv.slice(2);
  execFileSync(
    "pnpm",
    [
      "tauri",
      "build",
      "--config",
      configuration,
      ...(options[0] === "--" ? options.slice(1) : options),
    ],
    { cwd: root, stdio: "inherit" },
  );
}
