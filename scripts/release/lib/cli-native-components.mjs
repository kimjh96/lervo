import { cliNativeFiles } from "../../shared/cli-release-files.mjs";

export function cliNativeComponents(releaseManifest) {
  if (releaseManifest.schemaVersion !== 6) return [];
  return cliNativeFiles.map((path) => {
    const entry = releaseManifest.archive.files.find((file) => file.path === path);
    if (!/^sha256:[a-f0-9]{64}$/u.test(entry?.sha256))
      throw new Error("release_native_component_missing");
    return {
      type: "file",
      "bom-ref": `lervo:native-file-sync:${path.slice("dist/native/".length)}`,
      name: path,
      hashes: [{ alg: "SHA-256", content: entry.sha256.slice(7) }],
    };
  });
}
