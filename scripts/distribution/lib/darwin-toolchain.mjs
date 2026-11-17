/**
 * The one toolchain that compiles every darwin native file a release records (ADR-0581).
 *
 * The committed release manifest holds the exact bytes of `file-sync-darwin.node` and
 * `cas-io-darwin.node`, and those bytes follow the compiler, linker, and SDK. Runner images change
 * their default Xcode, so every job that builds the files selects this Xcode with `DEVELOPER_DIR`
 * and checks it before compiling. The Xcode is installed on both `macos-15` and `macos-26`.
 * Changing any value here changes the native bytes, so the release metadata must be regenerated.
 */
export const darwinToolchainPin = Object.freeze({
  runner: "macos-15",
  developerDir: "/Applications/Xcode_26.3.app/Contents/Developer",
  xcode: "Xcode 26.3",
  clang: "Apple clang version 17.0.0 (clang-1700.6.4.2)",
  sdk: "26.2",
  sdkBuild: "25C58",
});

/** The fields compared, each the first line of one toolchain query. */
export const darwinToolchainFields = Object.freeze([
  "developerDir",
  "xcode",
  "clang",
  "sdk",
  "sdkBuild",
]);

/** Returns the names of the observed fields that differ from the pin, in field order. */
export function darwinToolchainMismatches(observed, pin = darwinToolchainPin) {
  return darwinToolchainFields.filter((field) => observed?.[field] !== pin[field]);
}
