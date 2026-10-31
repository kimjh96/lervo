/** Schema 10 inventories the stable launcher separately from the host software it starts. */
export function terminalHookComponents(manifest) {
  if (!(manifest.schemaVersion >= 10)) return [];
  return ["dist/terminal-hook-launcher.mjs", "dist/terminal-hook.js"].map((path) => {
    const file = manifest.archive.files.find((entry) => entry.path === path);
    if (!file || !/^sha256:[a-f0-9]{64}$/u.test(file.sha256))
      throw new Error("release_terminal_hook_component_missing");
    return {
      type: "file",
      "bom-ref": `lervo:${path}`,
      name: path,
      hashes: [{ alg: "SHA-256", content: file.sha256.slice(7) }],
      properties: [{ name: "lervo:terminal-hook:contract", value: "lervo_terminal_hooks_v2" }],
    };
  });
}
